package main

import (
	"os"
	"path/filepath"
	"strings"
)

type KnowledgeResult struct {
	Title   string `json:"title"`
	Snippet string `json:"snippet"`
	Source  string `json:"source"`
}

func ScanKnowledgeDomains(dir string) []string {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return []string{}
	}
	domains := make([]string, 0, len(entries))
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".zim") {
			domains = append(domains, strings.TrimSuffix(e.Name(), ".zim"))
		}
	}
	return domains
}

func ScanKnowledgeDomainsAll(localDir, nasPath string) []string {
	seen := make(map[string]struct{})
	var domains []string
	for _, dir := range []string{localDir, nasPath} {
		if dir == "" {
			continue
		}
		for _, d := range ScanKnowledgeDomains(dir) {
			if _, ok := seen[d]; !ok {
				seen[d] = struct{}{}
				domains = append(domains, d)
			}
		}
	}
	return domains
}

// SearchKnowledge performs a stub search across installed ZIM packs.
// Full ZIM content parsing is a future enhancement; returns placeholder
// entries so the endpoint is wired end-to-end.
func SearchKnowledge(dir, query, domain string) ([]KnowledgeResult, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, nil
	}
	var results []KnowledgeResult
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".zim") {
			continue
		}
		packDomain := strings.TrimSuffix(e.Name(), ".zim")
		if domain != "" && packDomain != domain {
			continue
		}
		results = append(results, KnowledgeResult{
			Title:   "[" + packDomain + "] " + query,
			Snippet: "ZIM content search not yet implemented. Pack at: " + filepath.Join(dir, e.Name()),
			Source:  packDomain,
		})
	}
	return results, nil
}

func SearchKnowledgeAll(localDir, nasPath, query, domain string) ([]KnowledgeResult, error) {
	local, err := SearchKnowledge(localDir, query, domain)
	if err != nil {
		return nil, err
	}
	if nasPath == "" {
		return local, nil
	}
	nas, err := SearchKnowledge(nasPath, query, domain)
	if err != nil {
		return local, nil
	}
	return append(local, nas...), nil
}
