package main

import (
	"fmt"
	"log"
	"time"

	"github.com/hashicorp/mdns"
)

// discoverQueenViaMDNS scans the LAN for a BorgClaw Queen (_borgclaw._tcp).
// Returns empty string if none found within 5 seconds.
func discoverQueenViaMDNS() string {
	entriesCh := make(chan *mdns.ServiceEntry, 8)
	go func() {
		if err := mdns.Query(&mdns.QueryParam{
			Service: "_borgclaw._tcp", Domain: "local",
			Timeout: 5 * time.Second, Entries: entriesCh,
		}); err != nil {
			log.Printf("[mdns] query error: %v", err)
		}
		close(entriesCh)
	}()

	for entry := range entriesCh {
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
