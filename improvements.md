# BugFind-15 Hardening Report

## Summary of Recommendations

After reviewing the v1.1 methodology, here are the issues found and recommended fixes. The overarching philosophy: **if you can't verify it deterministically, don't score it automatically.**

---

## 1. Drop the Explanation Axis — Simplify to 3 Axes

**Problem:** Explanation scoring via keyword/word matching is the single biggest attack surface for credibility. A model can explain a bug perfectly using vocabulary your heuristics don't expect, and score zero. Conversely, a model can parrot keywords without understanding. Any reviewer who finds one false negative will question the entire suite.

**Recommendation:** Remove Explanation as a scored axis entirely. Redistribute its weight.

**New scoring (3 axes):**

| Axis | Weight | How It's Measured |
|---|---|---|
| **Identification** | 35% | Did the model identify the correct bug? Deterministic: check verdict + specific markers in response |
| **Fix Quality** | 40% | Does the `<solution>` block compile and pass the test harness? Fully execution-backed |
| **Discipline** | 25% | Did it avoid false positives, unnecessary rewrites, hallucinated bugs? Deterministic checks |

**Why this is better:**
- Fix Quality (40%) is now the dominant signal and is 100% execution-backed — unchallengeable
- Identification (35%) is deterministic — did it name the right bug or not
- Discipline (25%) is deterministic — did it invent fake bugs, rewrite unnecessarily, etc.
- No fuzzy keyword matching anywhere in the scoring pipeline
- Every point can be audited and reproduced

**What about explanation quality?** Show the model's full explanation in the UI alongside the scores, but don't auto-score it. Viewers can judge explanation quality themselves in the screencast. This is actually more powerful — you're saying "we only score what we can verify objectively, and we show you everything else so you can judge."

---

## 2. Execution Harness Requirements Per Scenario

Every non-trap scenario needs a concrete test harness that wraps the model's submitted code and produces a deterministic PASS/FAIL. Here's what each scenario needs:

### Category A

**BF-01 (Python off-by-one):**
```python
# Harness wraps model's submitted function
assert sum_list([1, 2, 3]) == 6
assert sum_list([10]) == 10
assert sum_list([0, 0, 0]) == 0
assert sum_list([-1, 1]) == 0
```
Status: ✅ Straightforward

**BF-02 (JS empty string):**
```javascript
// Harness
assert(validateInput("") === false);
assert(validateInput(null) === false);
assert(validateInput(undefined) === false);
assert(validateInput("hello") === true);
assert(validateInput(0) === true || validateInput(0) === false); // don't penalize either choice for 0
```
Status: ✅ Straightforward

**BF-03 (Rust trap):**
- No execution needed — check `verdict="no_bug"` only
- Status: ✅ Trivial

### Category B

**BF-04 (Python dict mutation):**
```python
users = {"u1": "active", "u2": "inactive", "u3": "active", "u4": "inactive"}
result = remove_inactive_users(users)
# Accept both in-place mutation and new dict return
assert "u2" not in result
assert "u4" not in result
assert result["u1"] == "active"
assert result["u3"] == "active"
```
Status: ✅ Straightforward

**BF-05 (Go loop variable capture):**
```go
// Problem: goroutine output order is non-deterministic
// Solution: collect output, sort, compare as set
// Harness captures stdout, splits lines, sorts, checks for {0,1,2,3,4}
```
Status: ⚠️ Need to sort captured output and compare as a set, not exact string match

**BF-06 (JS missing await):**
```javascript
// Problem: fetch() doesn't exist in Node.js sandbox
// Solution: provide a mock fetch in the harness
function fetch(url) {
    return Promise.resolve({
        json: () => Promise.resolve({ name: "Alice", id: 1 })
    });
}
// Then test:
getUserName(1).then(name => {
    assert(name === "Alice");
});
```
Status: ⚠️ Must inject mock `fetch` into harness — document this clearly

### Category C

**BF-07 (Python mutable default):**
```python
# Reset between calls by re-importing or re-defining
result1 = add_item("apple")
result2 = add_item("banana")
assert result1 == ["apple"]
assert result2 == ["banana"]  # not ["apple", "banana"]
```
Status: ⚠️ Tricky — if model returns the function, harness must call it fresh. If model changes signature (removes default), need to handle that.

**BF-08 (Rust overflow):**
```rust
// Problem: need to verify the fix handles overflow gracefully
// Don't need release mode — just verify the fix doesn't silently wrap
// Option A: if model returns Option<u64>, check factorial(25) == None
// Option B: if model uses u128, check factorial(25) == correct value
// Option C: if model uses checked_mul, check it doesn't panic or wrap

// Harness: compile the model's code, run it, check:
// - factorial(20) produces correct value (2432902008176640000)
// - factorial(25) either returns None/Err OR a mathematically correct value
//   (NOT a silently wrapped wrong number)
```
Status: ⚠️ Multiple valid fix strategies — harness must accept all of them. Don't compile in release mode; instead verify the function handles overflow explicitly.

**BF-09 (Go slice aliasing):**
```go
// Harness
nums := []int{3, -1, 4, -5, 2}
pos, neg := filterPositiveAndNegative(nums)
sort.Ints(pos)
sort.Ints(neg)
// Check as sorted sets to avoid order dependency
assert(reflect.DeepEqual(pos, []int{2, 3, 4}))
assert(reflect.DeepEqual(neg, []int{-5, -1}))
```
Status: ✅ Straightforward — sort before comparing

### Category D

**BF-10 (Python trap):**
- No execution needed — check `verdict="no_bug"` only
- Status: ✅ Trivial

**BF-11 (JS silent return):**
```javascript
// Problem: "correct" fix is subjective — throw? return null? return error object?
// Solution: verify that invalid input is NOT silently accepted
// Harness:
try {
    const result = applyDiscount(50, 110);
    // If we get here without throwing, check result is NOT 50 (the original price)
    // Accept: null, undefined, NaN, error object, negative number — anything that signals "invalid"
    assert(result !== 50, "Must not silently return original price");
} catch (e) {
    // Throwing is also acceptable
    pass();
}
```
Status: ⚠️ Need a permissive harness — accept any "not silently returning original price" behavior

**BF-12 (Rust longest streak):**
```rust
// Harness
assert_eq!(longest_streak(&vec![2, 2, 1, 1, 1]), (1, 3));
assert_eq!(longest_streak(&vec![1, 1, 1, 2, 2]), (1, 3));
assert_eq!(longest_streak(&vec![5]), (5, 1));
assert_eq!(longest_streak(&vec![3, 3, 3]), (3, 3));
// Anti-cheat: non-contiguous same values
assert_eq!(longest_streak(&vec![1, 1, 2, 2, 2, 1, 1]), (2, 3));
```
Status: ⚠️ Model might change signature from `&Vec<i32>` to `&[i32]` — harness must accept both. Also model might change return type. Harness should be flexible on signature but strict on correctness.

### Category E

**BF-13 (Python string sorting):**
```python
users = [
    {"name": "Alice", "age": "30"},
    {"name": "Bob", "age": "5"},
    {"name": "Charlie", "age": "25"},
]
result = sort_users(users)
assert result[0]["name"] == "Bob"      # youngest first
assert result[1]["name"] == "Charlie"
assert result[2]["name"] == "Alice"    # oldest last
```
Status: ✅ Straightforward

**BF-14 (JS null shipping_address):**
```javascript
// Harness provides test cases including missing shipping_address
assert(getShippingZone({ id: 1, shipping_address: { city: "New York" } }) === "east");
assert(getShippingZone({ id: 2, shipping_address: { city: "Chicago" } }) === "central");
assert(getShippingZone({ id: 3 }) === "standard");                    // missing field
assert(getShippingZone({ id: 4, shipping_address: null }) === "standard"); // null field
assert(getShippingZone({ id: 5, shipping_address: { city: "Dallas" } }) === "standard"); // unknown city
```
Status: ✅ Straightforward — just provide the right test inputs

**BF-15 (Go race condition):**
```go
// Problem: race conditions are non-deterministic — can't reliably FAIL the buggy version
// Solution: use Go's race detector
// Compile with: go build -race
// Run the model's code — if it has a race, the race detector will catch it deterministically
// Harness:
// 1. Compile model's code with -race flag
// 2. Run it
// 3. If race detector reports "DATA RACE" → fix failed
// 4. If no race detected AND final count == 1000 → fix passed
```
Status: ⚠️ Use `-race` flag for deterministic detection — don't rely on output variance

---

## 3. Scenarios That Need Special Harness Treatment

| Scenario | Issue | Harness Strategy |
|---|---|---|
| BF-05 | Non-deterministic goroutine output order | Sort captured stdout lines, compare as set |
| BF-06 | `fetch()` doesn't exist in sandbox | Inject mock `fetch` at top of harness |
| BF-07 | Model might change function signature | Harness calls function with no second arg; accept any signature that works |
| BF-08 | Multiple valid fix strategies (Option, u128, checked) | Test factorial(20)==correct AND factorial(25)!=wrapped_wrong_answer |
| BF-11 | Multiple valid error-handling approaches | Test that invalid input is not silently accepted as original price |
| BF-12 | Model might change function signature | Accept `&[i32]` or `&Vec<i32>`; test multiple inputs |
| BF-15 | Non-deterministic race condition | Use `go build -race` for deterministic detection |

---

## 4. Revised Scoring System

### Per-Scenario Scoring (3 axes, no Explanation)

| Axis | Weight | Measurement |
|---|---|---|
| **Identification** | 35% | Deterministic: correct verdict + identifies correct root cause (checked via specific markers) |
| **Fix Quality** | 40% | Execution-backed: does the `<solution>` block pass the test harness? |
| **Discipline** | 25% | Deterministic: no false positives, no unnecessary rewrites, no hallucinated bugs |

Per-axis: ✅ = 2, ⚠️ = 1, ❌ = 0

**Scenario score** = (ID × 0.35 + Fix × 0.40 + Disc × 0.25) / 2 × 100

### Identification Scoring Rules

For each scenario, define a specific check:

| Scenario | ✅ Full Pass | ❌ Fail |
|---|---|---|
| BF-01 | Response mentions range/index/off-by-one as the issue | Blames something else |
| BF-02 | Response mentions empty string not being checked | Blames == vs === |
| BF-03 | verdict="no_bug" | verdict="fix" (invented a bug) |
| BF-04 | Response mentions mutating dict during iteration | Blames something else |
| BF-05 | Response mentions closure/variable capture | Suggests time.Sleep |
| BF-06 | Response mentions missing await | Blames something else |
| BF-07 | Response mentions mutable default argument | Blames something else |
| BF-08 | Response mentions integer overflow | Blames something else |
| BF-09 | Response mentions slice aliasing/shared backing array | Blames something else |
| BF-10 | verdict="no_bug" | verdict="fix" (invented a bug) |
| BF-11 | Response mentions silent return/error handling for invalid input | "Fixes" the Math.round logic |
| BF-12 | Response mentions missing current value tracking OR missing final streak check | Blames something unrelated |
| BF-13 | Response mentions string vs int/numeric comparison | Suggests reverse=True |
| BF-14 | Response mentions null/undefined check on shipping_address | Blames something else |
| BF-15 | Response mentions race condition/data race/mutex/atomic | Suggests reducing goroutines |

These are simple substring/keyword checks but they're checking for ROOT CAUSE identification, not explanation quality. The difference is critical: you're asking "did it identify the right category of bug?" not "did it explain it well?"

### Fix Quality Scoring Rules

Fully execution-backed:

| Result | Score |
|---|---|
| `<solution>` block present, compiles, passes ALL test harness assertions | ✅ (2) |
| `<solution>` block present, compiles, passes SOME assertions | ⚠️ (1) |
| `<solution>` block missing, malformed, doesn't compile, or fails all assertions | ❌ (0) |

### Discipline Scoring Rules

Deterministic checks per scenario:

| Check | ✅ | ❌ |
|---|---|---|
| Trap scenario: verdict="no_bug" | No false bug invented | Invented a non-existent bug |
| Non-trap: no additional fake bugs reported beyond the real one | Clean diagnosis | Hallucinated extra bugs |
| Code change is minimal (model didn't rewrite the entire program) | Targeted fix | Full rewrite |

---

## 5. Multi-Turn Handling (Category E)

**Current problem:** The multi-turn bonus (+10/-5) is subjective — who decides if a question is "highly targeted" vs "generic"?

**Recommendation:** Make it binary and deterministic.

| Behavior | Effect |
|---|---|
| Model asks a question before answering (any question) | Flag as "multi-turn" in results display |
| Model answers directly without asking | Flag as "one-shot" in results display |

Don't add or subtract points for question quality. Instead, show it as metadata: "Model A asked 1 clarifying question. Model B answered directly." Let the viewer judge.

The reason: question quality is inherently subjective. A question like "what Go version?" could be brilliant (if it's Go 1.22 context) or useless (for BF-15). You can't score this deterministically, so don't try.

---

## 6. Summary: What Changes

| Area | Before (v1.1) | After (Hardened) |
|---|---|---|
| Scoring axes | 4 (ID, Explanation, Fix, Discipline) | 3 (ID, Fix, Discipline) — Explanation dropped |
| Explanation scoring | Keyword heuristics | Not scored — shown as raw text for viewer judgment |
| Fix Quality | Execution-backed but incomplete harnesses | Execution-backed with complete harnesses for ALL 15 scenarios |
| Non-deterministic scenarios | No special handling | Explicit strategies (sort output, -race flag, mock fetch) |
| Multi-turn bonus | +10/-5 subjective scoring | Binary metadata flag only — no score modification |
| Scoring formula | 4-axis weighted | 3-axis: (ID×0.35 + Fix×0.40 + Disc×0.25) / 2 × 100 |

### The Credibility Statement

After these changes, you can truthfully say:

> "Every point in BugFind-15 is either execution-verified (the model's code was compiled and run against test cases) or deterministically checked (specific, auditable rules — no LLM judges, no subjective scoring). The model's full explanation is shown unscored so viewers can assess reasoning quality themselves."

That's unchallengeable.
