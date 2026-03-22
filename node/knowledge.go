package main

import (
	"os"
	"path/filepath"
	"strings"
)

// KnowledgeResult is a single search hit from a knowledge pack.
type KnowledgeResult struct {
	Title  string `json:"title"`
	Snippet string `json:"snippet"`
	Source string `json:"source"` // domain name the result came from
}

// ScanKnowledgeDomains reads the knowledge directory and returns a list of
// domain names derived from .zim filenames found there.
// "wikipedia-mini.zim" → "wikipedia-mini"
// Returns an empty slice (never nil) when the directory is missing or empty.
func ScanKnowledgeDomains(dir string) []string {
	entries, err := os.ReadDir(dir)
	if err != nil {
		// Directory doesn't exist or isn't readable — normal for new nodes.
		return []string{}
	}

	domains := make([]string, 0, len(entries))
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		name := e.Name()
		if strings.HasSuffix(name, ".zim") {
			domain := strings.TrimSuffix(name, ".zim")
			domains = append(domains, domain)
		}
	}
	return domains
}

// SearchKnowledge performs a stub search across installed knowledge packs.
//
// Full ZIM content parsing is a future enhancement. For now this returns
// empty results so the endpoint is wired end-to-end and callers can rely
// on the response shape. The domain list in pack_count already tells the
// Queen which nodes hold which knowledge.
//
// When domain is non-empty, only packs whose filename matches that domain are
// considered — this lets the Queen route domain-specific queries to the right
// drone before falling back.
func SearchKnowledge(dir, query, domain string) ([]KnowledgeResult, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		// No knowledge directory — not an error condition, just no packs.
		return nil, nil
	}

	results := make([]KnowledgeResult, 0)

	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".zim") {
			continue
		}

		packDomain := strings.TrimSuffix(e.Name(), ".zim")

		// If a domain filter was provided, skip non-matching packs.
		if domain != "" && packDomain != domain {
			continue
		}

		// Stub: ZIM content search is a future enhancement.
		// For packs that exist but content search isn't implemented yet,
		// we surface a single placeholder entry so callers know the pack
		// is present and can degrade gracefully.
		zimPath := filepath.Join(dir, e.Name())
		results = append(results, KnowledgeResult{
			Title:   "[" + packDomain + "] " + query,
			Snippet: "ZIM content search not yet implemented. Pack installed at: " + zimPath,
			Source:  packDomain,
		})
	}

	return results, nil
}
