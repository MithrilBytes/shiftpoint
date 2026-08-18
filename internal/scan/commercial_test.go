package scan

import (
	"encoding/json"
	"slices"
	"sort"
	"strings"
	"testing"
)

func TestDetectCommercialAnswersYesOrUnclear(t *testing.T) {
	cases := []struct {
		name  string
		files map[string]string
		want  []string
	}{
		{
			name:  "a payment processor in a manifest",
			files: map[string]string{"package.json": `{"dependencies":{"stripe":"^15"}}`},
			want:  []string{"yes"},
		},
		{
			name:  "a pricing route with no payment code at all",
			files: map[string]string{"package.json": "{}", "app/pricing/page.tsx": "export default () => null;"},
			want:  []string{"yes"},
		},
		{
			name:  "a checkout route",
			files: map[string]string{"package.json": `{"dependencies":{"next":"^14"}}`, "app/checkout/page.tsx": "export default () => null;"},
			want:  []string{"yes"},
		},
		{
			name:  "a merchant credential in a sample environment",
			files: map[string]string{".env.example": "DATABASE_URL=postgres://x\nSTRIPE_SECRET_KEY=\n"},
			want:  []string{"yes"},
		},
		{
			name:  "support tooling a weekend project does not buy",
			files: map[string]string{"package.json": `{"dependencies":{"@hubspot/api-client":"^11"}}`},
			want:  []string{"yes"},
		},
		{
			// A microservice directory is not a checkout page, and calling it
			// one promoted a private tool from free to $20/mo.
			name: "an internal billing service",
			files: map[string]string{
				"services/billing/go.mod":  "module x\n\ngo 1.22\n",
				"services/billing/main.go": "package main\n",
			},
			want: []string{"unclear"},
		},
		{
			name:  "documentation about pricing",
			files: map[string]string{"docs/pricing.md": "# what it costs\n"},
			want:  []string{"unclear"},
		},
		{
			name:  "an ordinary application",
			files: map[string]string{"package.json": `{"dependencies":{"next":"^14"}}`},
			want:  []string{"unclear"},
		},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			signals := DetectCommercial(build(t, testCase.files))
			if got := signalFor(t, signals, FieldCommercial).Values; !slices.Equal(got, testCase.want) {
				t.Errorf("got %v, want %v", got, testCase.want)
			}
		})
	}
}

func TestUnclearIsLowConfidenceAndNeverNo(t *testing.T) {
	// A business can invoice outside the product and ship no payment code, so
	// an absence of evidence is not evidence of absence and is not reported as
	// one.
	signal := signalFor(t, DetectCommercial(build(t, map[string]string{"package.json": `{"dependencies":{"next":"^14"}}`})), FieldCommercial)

	if !slices.Equal(signal.Values, []string{"unclear"}) {
		t.Errorf("got %v, want [unclear]", signal.Values)
	}
	if signal.Confidence != Low {
		t.Errorf("got %v confidence, want low", signal.Confidence)
	}
	if slices.Contains(signal.Values, None) {
		t.Error("reported an absence of commercial intent, which nothing here can prove")
	}
}

func TestEveryPaymentProcessorReadsAsCommercial(t *testing.T) {
	// A mutation pass deleted single entries from this table and the suite
	// stayed green, because only the names a fixture happened to use were
	// pinned. Walking the table is what makes an unreachable entry impossible.
	names := make([]string, 0, len(ProcessorByDependency))
	for name := range ProcessorByDependency {
		names = append(names, name)
	}
	sort.Strings(names)

	for _, name := range names {
		t.Run(name, func(t *testing.T) {
			manifest, err := json.Marshal(map[string]map[string]string{"dependencies": {name: "^1.0.0"}})
			if err != nil {
				t.Fatal(err)
			}
			repo := build(t, map[string]string{"package.json": string(manifest)})
			if got := signalFor(t, DetectCommercial(repo), FieldCommercial).Values; !slices.Equal(got, []string{"yes"}) {
				t.Errorf("got %v, want [yes]", got)
			}
		})
	}
}

func TestCommercialEvidenceIsStable(t *testing.T) {
	// The dependency set arrives in whatever order Go feels like, so the
	// evidence is sorted before it is written down. Without that a rerun of
	// the same repository reads differently every time.
	repo := build(t, map[string]string{"package.json": `{"dependencies":{"stripe":"^15","braintree":"^3","intercom":"^1"}}`})

	first := signalFor(t, DetectCommercial(repo), FieldCommercial).Evidence
	want := "a manifest depends on braintree; a manifest depends on stripe; a manifest depends on intercom"
	if first != want {
		t.Errorf("got %q, want %q", first, want)
	}
	for i := 0; i < 8; i++ {
		if again := signalFor(t, DetectCommercial(repo), FieldCommercial).Evidence; again != first {
			t.Fatalf("evidence changed between runs: %q then %q", first, again)
		}
	}
}

func TestMerchantCredentialIsCreditedOncePerVendor(t *testing.T) {
	repo := build(t, map[string]string{".env": "STRIPE_SECRET_KEY=x\nSTRIPE_WEBHOOK_SECRET=y\nSHOPIFY_API_KEY=z\n"})

	evidence := signalFor(t, DetectCommercial(repo), FieldCommercial).Evidence
	if strings.Count(evidence, ".env sets STRIPE") != 1 {
		t.Errorf("one vendor was credited twice: %q", evidence)
	}
	if !strings.Contains(evidence, ".env sets SHOPIFY_API_KEY") {
		t.Errorf("a second vendor went unread: %q", evidence)
	}
}
