package main

// discoverQueenViaMDNS scans the LAN for a BorgClaw Queen advertised via
// mDNS (_borgclaw._tcp) and returns its URL. It waits up to 5 seconds.
// Returns an empty string if no Queen is found — the caller decides what
// to do with a miss (typically: print a helpful error and exit).

import (
	"fmt"
	"log"
	"time"

	"github.com/hashicorp/mdns"
)

func discoverQueenViaMDNS() string {
	entriesCh := make(chan *mdns.ServiceEntry, 8)

	params := &mdns.QueryParam{
		Service:             "_borgclaw._tcp",
		Domain:              "local",
		Timeout:             5 * time.Second,
		Entries:             entriesCh,
		WantUnicastResponse: false,
	}

	// Start query in background — it closes entriesCh when done or timed out
	go func() {
		if err := mdns.Query(params); err != nil {
			log.Printf("[mdns] query error: %v", err)
		}
		close(entriesCh)
	}()

	for entry := range entriesCh {
		// Take the first valid result
		if entry.AddrV4 == nil && entry.AddrV6 == nil {
			continue
		}

		host := ""
		if entry.AddrV4 != nil {
			host = entry.AddrV4.String()
		} else {
			host = fmt.Sprintf("[%s]", entry.AddrV6.String())
		}

		url := fmt.Sprintf("http://%s:%d", host, entry.Port)
		log.Printf("[init] discovered Queen at %s via mDNS", url)
		return url
	}

	return ""
}
