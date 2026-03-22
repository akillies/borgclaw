// ============================================================
// NATS JetStream Client — Event Bus Integration
// ============================================================
// Connects to NATS at localhost:4222 (or NATS_URL env var).
// Creates the BORGCLAW stream with subject filter "hive.>".
//
// Subject taxonomy:
//   hive.workflow.started       — workflow execution begins
//   hive.workflow.completed     — workflow finished successfully
//   hive.workflow.failed        — workflow failed
//   hive.workflow.paused        — waiting on approval gate
//   hive.approval.created       — new approval in queue
//   hive.approval.resolved      — approval approved or rejected
//   hive.node.registered        — new node joined the hive
//   hive.node.offline           — node missed heartbeat window
//   hive.node.heartbeat         — periodic node status pulse
//   hive.hive.halted            — operator triggered kill switch
//   hive.hive.resumed           — operator resumed the hive
//   hive.activity               — forwarded activity feed events
//
// Design contract:
//   - Queen MUST NOT crash if NATS is unavailable.
//   - All publish calls are fire-and-forget (no await required).
//   - initNats() resolves even on failure; it logs a warning and
//     leaves the client null. Everything else becomes a no-op.
//   - subscribe() returns an async iterator; callers handle their
//     own message loops.
// ============================================================

import { connect, JSONCodec, consumerOpts, RetentionPolicy, StorageType } from 'nats';

// ============================================================
// Module state
// ============================================================

const STREAM_NAME = 'BORGCLAW';
const STREAM_SUBJECTS = ['hive.>'];
const NATS_URL = process.env.NATS_URL || 'nats://localhost:4222';

let nc = null;       // NatsConnection
let js = null;       // JetStreamClient
let jc = null;       // JSONCodec instance
let connected = false;

// ============================================================
// initNats — connect and create stream
// ============================================================

/**
 * Connect to NATS and ensure the BORGCLAW JetStream stream exists.
 *
 * Safe to call at startup. If NATS is not running, logs a warning
 * and returns without throwing. The module degrades gracefully —
 * all subsequent publish/subscribe calls become no-ops.
 *
 * @returns {Promise<boolean>} true if connected, false if unavailable
 */
export async function initNats() {
  try {
    nc = await connect({
      servers: NATS_URL,
      timeout: 3000,         // fail fast if NATS is not up
      reconnect: true,
      maxReconnectAttempts: -1,   // retry indefinitely in background
      reconnectTimeWait: 5000,    // 5s between reconnect attempts
      waitOnFirstConnect: false,  // don't block — fail and degrade
    });

    jc = JSONCodec();
    js = nc.jetstream();

    // Ensure the stream exists — addStream is idempotent if config matches
    const jsm = await nc.jetstreamManager();
    try {
      await jsm.streams.add({
        name: STREAM_NAME,
        subjects: STREAM_SUBJECTS,
        storage: StorageType.File,
        retention: RetentionPolicy.Limits,
        max_age: 7 * 24 * 60 * 60 * 1e9,  // 7 days in nanoseconds
        max_msgs: 100_000,
        max_bytes: 512 * 1024 * 1024,      // 512 MB
        num_replicas: 1,
      });
      console.log(`[NATS] Stream '${STREAM_NAME}' created`);
    } catch (err) {
      // Stream already exists — update it in case config has drifted
      if (err.message?.includes('stream name already in use')) {
        await jsm.streams.update(STREAM_NAME, {
          subjects: STREAM_SUBJECTS,
          max_age: 7 * 24 * 60 * 60 * 1e9,
          max_msgs: 100_000,
          max_bytes: 512 * 1024 * 1024,
          num_replicas: 1,
        });
        console.log(`[NATS] Stream '${STREAM_NAME}' updated`);
      } else {
        // Non-fatal stream config error — log but keep the connection
        console.warn(`[NATS] Stream setup warning: ${err.message}`);
      }
    }

    connected = true;

    // Watch for connection close (server-side disconnect)
    nc.closed().then(() => {
      connected = false;
      console.warn('[NATS] Connection closed');
    }).catch(() => {
      connected = false;
    });

    // Status iterator — log reconnects without crashing
    (async () => {
      for await (const status of nc.status()) {
        if (status.type === 'reconnecting') {
          console.warn(`[NATS] Reconnecting... (attempt ${status.data})`);
        } else if (status.type === 'reconnect') {
          connected = true;
          console.log('[NATS] Reconnected');
        } else if (status.type === 'disconnect') {
          connected = false;
          console.warn('[NATS] Disconnected');
        }
      }
    })().catch(() => {});

    console.log(`[NATS] Connected to ${NATS_URL}`);
    return true;

  } catch (err) {
    // NATS not available — Queen operates in degraded mode
    nc = null;
    js = null;
    jc = null;
    connected = false;
    console.warn(`[NATS] Unavailable at ${NATS_URL} — running without event bus (${err.message})`);
    return false;
  }
}

// ============================================================
// publish — fire and forget
// ============================================================

/**
 * Publish a JSON payload to a JetStream subject.
 *
 * Subject examples:
 *   "hive.workflow.started"
 *   "hive.node.heartbeat"
 *   "hive.approval.created"
 *
 * No-op if NATS is not connected.
 *
 * @param {string} subject
 * @param {object} data  — must be JSON-serialisable
 * @returns {Promise<void>}
 */
export async function publish(subject, data) {
  if (!connected || !js || !jc) return;

  try {
    await js.publish(subject, jc.encode(data));
  } catch (err) {
    // Publishing failures are non-fatal — hive continues without NATS
    console.warn(`[NATS] Publish failed on '${subject}': ${err.message}`);
  }
}

// ============================================================
// subscribe — async iterator consumer
// ============================================================

/**
 * Subscribe to a subject pattern via JetStream push consumer.
 *
 * Returns an async iterable of decoded message objects.
 * The caller is responsible for the message loop.
 *
 * Usage:
 *   const sub = await subscribe('hive.workflow.>', myHandler);
 *   // handler is called for each message
 *
 * No-op (returns null) if NATS is not connected.
 *
 * @param {string} subject  — subject pattern, e.g. "hive.>"
 * @param {Function} handler  — async (data, subject) => void
 * @returns {Promise<object|null>}  — subscription handle or null
 */
export async function subscribe(subject, handler) {
  if (!connected || !js || !jc) return null;

  try {
    // Ephemeral ordered push consumer — auto-cleanup on unsub, no ack required.
    // consumerOpts() builds the options; deliverLastPerSubject() starts from
    // the most recent retained message on each subject.
    const opts = consumerOpts();
    opts.deliverLastPerSubject();
    opts.ackNone();
    opts.filterSubject(subject);

    const sub = await js.subscribe(subject, opts);

    // Drive the message loop in the background
    (async () => {
      for await (const msg of sub) {
        try {
          const data = jc.decode(msg.data);
          await handler(data, msg.subject);
        } catch (err) {
          console.warn(`[NATS] Handler error on '${msg.subject}': ${err.message}`);
        }
      }
    })().catch(err => {
      console.warn(`[NATS] Subscription loop ended: ${err.message}`);
    });

    return sub;
  } catch (err) {
    console.warn(`[NATS] Subscribe failed on '${subject}': ${err.message}`);
    return null;
  }
}

// ============================================================
// close — graceful shutdown
// ============================================================

/**
 * Drain and close the NATS connection.
 *
 * Drain ensures all in-flight published messages are flushed
 * before the connection drops. Safe to call multiple times.
 *
 * @returns {Promise<void>}
 */
export async function close() {
  if (!nc) return;

  try {
    await nc.drain();
    console.log('[NATS] Connection drained and closed');
  } catch (err) {
    console.warn(`[NATS] Error during drain: ${err.message}`);
  } finally {
    nc = null;
    js = null;
    jc = null;
    connected = false;
  }
}

// ============================================================
// isConnected — status check
// ============================================================

/** @returns {boolean} */
export function isConnected() {
  return connected;
}
