# BugFind-15: A Practical LLM Debugging Test Suite

**Version 1.0 — March 2026**
**Public methodology specification · Designed for reproducible, visual LLM comparison**

---

## Overview

BugFind-15 measures how well LLMs can identify, fix, and communicate debugging decisions in real code. Most scenarios contain exactly one intentional bug. Two scenarios (BF-03 and BF-10) are **trap scenarios** where the code is correct and the model must resist inventing a bug.

The suite covers 4 languages (Python, JavaScript, Rust, Go) across 5 categories, with both one-shot and multi-turn scenarios.

Canonical buggy and fixed variants for all scenarios are executed inside a dedicated Docker verifier. Official scoring requires the model's final answer to contain exactly one machine-readable `<solution>` block so the benchmark can execute the model's exact proposed fix rather than inferring one from prose.

If you find a discrepancy between the documented scenario behavior and the verifier, please open an issue.

---

## Design Principles

1. **One bug per scenario (with explicit exceptions).** No multi-bug hunts. We're measuring diagnostic precision, not endurance. Two scenarios (BF-03 and BF-10) are clearly marked trap scenarios containing no bug.
2. **Every scenario is verified.** The buggy code has been executed and produces exactly the error or incorrect output described. The canonical fixed code has also been executed and produces the correct output.
3. **Red herrings are intentional.** Some scenarios include suspicious-looking-but-correct code to test whether the model gets distracted.
4. **Language diversity is balanced.** Python (5), JavaScript (4), Rust (3), Go (3).
5. **Both one-shot and multi-turn.** One-shot tests raw diagnostic ability. Multi-turn tests whether the model asks smart clarifying questions.
6. **Official scoring uses exact model output.** For non-trap scenarios, the verifier executes only the code inside the model's final `<solution verdict="fix">...</solution>` block. For trap scenarios, the model must explicitly return `verdict="no_bug"` with an empty solution block.
7. **Structured output is part of the benchmark.** The suite is intentionally measuring not only diagnosis and repair quality, but also whether the model can follow a precise debugger-output contract.

---

## Test Environment Setup

### System Prompt (used for ALL scenarios)

```
You are an expert software debugger. The user will show you code that may have a bug.

Your job:
1. IDENTIFY the bug — point to the exact line(s) and explain what is wrong.
2. EXPLAIN why it causes the observed behavior.
3. FIX the code — provide the corrected version.

Rules:
- Do not rewrite the entire program. Only change what is necessary.
- If the code looks correct and the described behavior seems impossible, say so.
- If you need more information to diagnose the bug, ask specific questions.
- Do not introduce new functionality. Only fix the bug.
- Your final answer may include brief explanation text outside the solution block, but it must include exactly one machine-readable solution block using this format:
  <solution language="python|javascript|rust|go" verdict="fix">
  corrected code here
  </solution>
- Inside <solution verdict="fix">, include raw valid source code only.
- Do not put explanations, bullet points, placeholders, XML/HTML tags, or markdown fences such as \`\`\` inside the <solution> block.
- Do not write phrases like "corrected code here" or "fixed code".
- Do not wrap the answer in tags like <response>, <analysis>, <fixed_code>, or <parameter>.
- Use verdict="fix" only when you are actually providing corrected code.
- For trap scenarios where there is no bug, put your explanation outside the block and use exactly this empty block:
  <solution language="python|javascript|rust|go" verdict="no_bug"></solution>
- When verdict="no_bug", the <solution> block must be completely empty.
- If you ask a clarification question first, do not include a <solution> block yet. Once you give the final answer, include exactly one <solution> block.
```

### Official Answer Contract

Official scoring accepts exactly one final `<solution>` block.

For bug scenarios:

```xml
<solution language="python|javascript|rust|go" verdict="fix">
raw valid code only
</solution>
```

For trap scenarios (BF-03, BF-10):

```xml
<solution language="python|javascript|rust|go" verdict="no_bug"></solution>
```

Important consequences:

- The verifier does not execute prose.
- The verifier does not execute Markdown fences inside `<solution>`.
- Malformed or missing `<solution>` blocks fail official execution verification.
- `verdict="no_bug"` is only valid for BF-03 and BF-10.
- For trap scenarios, the explanation belongs outside the empty `<solution>` block.

### Verification Sandbox

Official verification runs in a dedicated Docker service rather than inside the web app process.

Pinned runtime/compiler stack:

- Python: `python3` from `debian:bookworm-slim`
- Node.js: `22.18.0`
- Go: `1.21.13`
- Rust: `1.78.0`

The verifier service exposes:

- `GET /health`
- `POST /verify-canonical`
- `POST /verify-answer`

The container is run with network disabled and restricted privileges. This is both for safety and to ensure deterministic language/runtime behavior.

Important verifier details:

- The verifier executes the model's exact tagged solution, but it may apply minimal harness-only normalization when the prompt snippet itself contains irrelevant compile-time baggage.
- Example: BF-09 includes an unused `fmt` import in the prompt snippet. The verifier ignores that prompt-carried unused import so valid slice-aliasing fixes are not rejected for an unrelated compile error.
- The verifier accepts multiple valid fix strategies when they are behaviorally equivalent under the scenario contract.
- Example: BF-08 accepts `u128`, `Option`/`Result`, big-integer approaches, and explicit overflow-signaling behavior including panic-based `checked_mul(...).expect(...)`, as long as the submission does not silently wrap and still produces the correct `20!` value.

### Verification Flow

Official benchmark flow:

1. Frontend sends the scenario prompt to the selected model.
2. The model may ask a clarification question in Category E scenarios.
3. Once the model returns its final answer, the app extracts the final response and sends it to the verifier service.
4. The verifier parses the exact `<solution>` block.
5. The verifier wraps the submitted code with a scenario-specific harness when needed.
6. The verifier compiles or runs the submitted code with the native runtime/compiler for that language.
7. The verifier compares behavior against the scenario's canonical fixed checks.

This means official `Fix Quality` is based on executable behavior of the model's exact submitted solution, not on a synthesized or inferred fix.

### Scoring Dimensions

Every scenario is scored on a simple 3-point scale across 3 axes:

| Axis | Weight | Description |
|---|---|---|
| **Identification** | 35% | Did the model find the correct bug (or correctly identify no bug in trap scenarios)? |
| **Fix Quality** | 40% | Does the submitted `<solution>` block compile/run correctly and fix the bug without introducing new problems? |
| **Discipline** | 25% | Did it avoid false positives, unnecessary rewrites, or hallucinated bugs? |

Per-axis scoring: ✅ = 2 points, ⚠️ = 1 point, ❌ = 0 points.

**Scenario score** = weighted sum of axis scores, normalized to 0–100.

For trap scenarios (BF-03, BF-10), the axes are reinterpreted as: Identification = correctly recognizes no bug; Fix Quality = correctly provides `verdict="no_bug"`; Discipline = resists inventing false issues.

### How Each Axis Is Measured

- **Identification:** deterministic rubric checks, scenario by scenario
- **Fix Quality:** execution-backed when the `<solution>` block is valid
- **Discipline:** deterministic rubric checks, scenario by scenario

Explanation is still shown in the UI and traces, but it is no longer auto-scored. The benchmark only scores dimensions that can be defended deterministically.

### Execution-Backed Fix Quality

Fix Quality is evaluated as follows:

- If the final answer contains a valid `<solution verdict="fix">` block, that exact code is executed in the verifier sandbox.
- If the code passes the scenario's canonical fixed checks, `Fix Quality` receives full credit.
- If the code compiles/runs but fails the checks, `Fix Quality` receives no execution credit.
- If the final answer is malformed or missing the required `<solution>` block, official execution verification fails.
- For trap scenarios, `verdict="no_bug"` is the only valid execution-backed answer shape.
- In multi-turn scenarios, only the final answer is used for official execution verification. A correct code block in an earlier turn does not count unless the final answer still contains a valid `<solution>` block.

The benchmark prefers exactness and auditability over trying to "rescue" malformed answers by inferring the intended fix.

---

## Category A: Syntax & Surface Errors (One-Shot)

### BF-01: Off-by-One in Python Loop

**Language:** Python
**Difficulty:** Easy

**User message:**

> This function should return the sum of all elements in a list, but it's throwing an IndexError. Can you find the bug?

```python
def sum_list(numbers):
    total = 0
    for i in range(1, len(numbers) + 1):
        total += numbers[i]
    return total

# sum_list([1, 2, 3])  → IndexError: list index out of range
# sum_list([10])        → IndexError: list index out of range
```

**The bug:** `range(1, len(numbers) + 1)` produces indices starting at 1 and ending at `len(numbers)`. For a 3-element list, this gives indices `1, 2, 3`. Index `3` is out of bounds (valid indices are `0, 1, 2`). Even for a single-element list `[10]`, it tries to access index `1`, which doesn't exist. Additionally, index `0` is never accessed, so even if it didn't crash, it would skip the first element.

**Verified behavior:**
```
sum_list([10])      → IndexError: list index out of range
sum_list([1, 2, 3]) → IndexError: list index out of range
```

**The fix:**
```python
for i in range(len(numbers)):
```
Or more idiomatically:
```python
for num in numbers:
    total += num
```

**Scoring:**

| Result | Score |
|---|---|
| Identifies off-by-one (both the crash AND the skipped first element) and provides correct fix | ✅ Full pass |
| Identifies the crash but doesn't mention index 0 is skipped | Transcript still shows the reasoning, but there is no separate explanation score |
| Provides overly complex fix (e.g., rewrites entire function with enumerate) | ⚠️ Half credit on Discipline |
| Misdiagnoses as a different bug | ❌ Fail |

---

### BF-02: JavaScript Equality Trap

**Language:** JavaScript
**Difficulty:** Easy

**User message:**

> This validation function should reject empty strings, but `validateInput("")` returns `true`. What's wrong?

```javascript
function validateInput(input) {
    if (input !== null && input !== undefined && input !== false) {
        return true;
    }
    return false;
}

// validateInput("")         → true   ← BUG: should be false
// validateInput(null)       → false  ✓
// validateInput(undefined)  → false  ✓
// validateInput("hello")    → true   ✓
```

**The bug:** The function checks for `null`, `undefined`, and `false`, but never checks for empty string `""`. An empty string is none of those three values, so it passes all checks and returns `true`.

**Verified behavior:** `validateInput("")` returns `true`.

**The fix:**
```javascript
if (input !== null && input !== undefined && input !== false && input !== "") {
```
Or more idiomatically:
```javascript
if (input) {  // falsy check covers all cases
```

**Scoring:**

| Result | Score |
|---|---|
| Identifies missing empty string check, explains that `""` is not `null`/`undefined`/`false` | ✅ Full pass |
| Correct fix but explains it as "type coercion bug" (it's not — it's a missing case) | Transcript reveals the explanation quality issue, but there is no separate explanation score |
| Suggests `input.length > 0` without addressing the root logic gap | ⚠️ Half credit |
| Misidentifies as a `==` vs `===` issue | ❌ Fail |

---

### BF-03: Rust — Code That Actually Compiles (Trap Scenario)

**Language:** Rust
**Difficulty:** Easy
**Type:** Trap — there is NO bug

**User message:**

> This Rust code won't compile. The compiler says "value used here after move" but I don't understand why. Can you help?

```rust
fn main() {
    let name = String::from("Alice");
    let greeting = format!("Hello, {}", name);
    println!("{}", greeting);
    println!("Name was: {}", name);  // ERROR: value used after move
}
```

**The truth:** This code compiles and runs correctly. The `format!` macro borrows its arguments by reference — it does NOT move `name`. The user has either misread their error, confused this with different code (such as a function that takes `String` by value), or is testing the model.

**Expected behavior:** The model should recognize that this code is valid Rust and that `format!` borrows rather than moves. It should tell the user the code is correct and ask them to double-check their actual error message or provide the real code that fails.

**Scoring:**

| Result | Score |
|---|---|
| Correctly identifies that this code compiles fine, explains `format!` borrows | ✅ Full pass |
| Says "add `.clone()`" or "use `&name`" — fixing a bug that doesn't exist | ❌ Fail — false positive |
| Explains ownership correctly but still suggests an unnecessary "just in case" change | ⚠️ Half credit on Discipline |

---

## Category B: Logic & Algorithmic Errors (One-Shot)

### BF-04: Python Dictionary Mutation During Iteration

**Language:** Python
**Difficulty:** Medium

**User message:**

> This function should remove all users with "inactive" status, but it crashes with `RuntimeError: dictionary changed size during iteration`. What am I doing wrong?

```python
def remove_inactive_users(users):
    for user_id, status in users.items():
        if status == "inactive":
            del users[user_id]
    return users

users = {"u1": "active", "u2": "inactive", "u3": "active", "u4": "inactive"}
print(remove_inactive_users(users))
```

**The bug:** You cannot modify a dictionary's size while iterating over it in Python 3. The `del` inside the `for` loop triggers a `RuntimeError`.

**Verified behavior:** `RuntimeError: dictionary changed size during iteration`

**The fix:**
```python
def remove_inactive_users(users):
    return {uid: status for uid, status in users.items() if status != "inactive"}
```
Or (two-pass approach):
```python
def remove_inactive_users(users):
    to_remove = [uid for uid, status in users.items() if status == "inactive"]
    for uid in to_remove:
        del users[uid]
    return users
```

**Note:** `list(users.items())` also works as a fix (iterating over a snapshot), but the model should explain why it works.

**Scoring:**

| Result | Score |
|---|---|
| Explains mutation-during-iteration, provides dict comprehension or two-pass fix | ✅ Full pass |
| Suggests `list(users.items())` and explains it creates a snapshot | ✅ Full pass |
| Suggests `list(users.items())` without explaining why it fixes the issue | Transcript reveals the explanation gap, but there is no separate explanation score |
| Suggests try/except around the del | ❌ Fail — band-aid, not a fix |
| Rewrites entire function with unnecessary changes | ⚠️ Half credit on Discipline |

---

### BF-05: Go Goroutine Loop Variable Capture

**Language:** Go
**Difficulty:** Medium
**Assumed Go version:** Pre-1.22 (see note below)

**User message:**

> I'm running Go 1.21. I'm trying to print numbers 0–4 using goroutines, but the output is always "5 5 5 5 5" instead. What's going on?

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    var wg sync.WaitGroup
    for i := 0; i < 5; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            fmt.Println(i)
        }()
    }
    wg.Wait()
}
```

**The bug:** The goroutine closure captures the variable `i` by reference, not by value. By the time the goroutines execute, the loop has completed and `i` equals 5. All goroutines read the same final value.

**Important version note:** In Go 1.22+, the loop variable semantics changed — each iteration gets its own copy of `i`, and this code would work correctly. The user message explicitly states Go 1.21 to remove ambiguity. If the model mentions the Go 1.22 change, it demonstrates up-to-date knowledge — award bonus credit.

**The fix:**
```go
go func(n int) {
    defer wg.Done()
    fmt.Println(n)
}(i)
```

**Verifier note:** Goroutine print order is non-deterministic. The official harness captures stdout, parses the printed integers, sorts them, and compares the resulting set against `{0,1,2,3,4}` rather than requiring a fixed print order.

**Scoring:**

| Result | Score |
|---|---|
| Explains closure captures reference, provides parameter-passing fix | ✅ Full pass |
| Correct fix but doesn't explain WHY all values are 5 | Transcript reveals the explanation gap, but there is no separate explanation score |
| Mentions Go 1.22 loop variable change | ✅ Bonus credit (note in results) |
| Suggests adding `time.Sleep` to "fix" timing | ❌ Fail — doesn't fix the root cause |

---

### BF-06: JavaScript Async/Await Missing Await

**Language:** JavaScript
**Difficulty:** Medium

**User message:**

> This function should fetch a user and return their name, but it throws `TypeError: response.json is not a function`. The API is definitely working — I checked in the browser.

```javascript
async function getUserName(userId) {
    const response = fetch(`/api/users/${userId}`);
    const data = response.json();
    return data.name;
}
```

**The bug:** `fetch()` returns a Promise, not the Response object. Without `await`, `response` is a pending Promise. Promise objects don't have a `.json()` method, so `response.json()` throws `TypeError: response.json is not a function`.

**Verified behavior:** `TypeError: response.json is not a function` (Promise has no `.json` method).

**The fix:**
```javascript
async function getUserName(userId) {
    const response = await fetch(`/api/users/${userId}`);
    const data = await response.json();
    return data.name;
}
```

**Verifier note:** The sandbox injects a mock `fetch()` implementation because Node.js does not provide browser `fetch` semantics by default in this harnessed scenario. The submitted code is expected to resolve to the mocked user record and return the user's name.

**Scoring:**

| Result | Score |
|---|---|
| Identifies both missing `await` keywords, explains Promise vs resolved value | ✅ Full pass |
| Only adds `await` to `fetch` but misses `response.json()` needing `await` too | ⚠️ Half credit — incomplete fix |
| Correct fix but doesn't explain what happens when you omit `await` | Transcript reveals the explanation gap, but there is no separate explanation score |
| Suggests wrapping in `.then()` chains instead — technically works but goes against the function's async pattern | ⚠️ Half credit on Discipline |

---

## Category C: Subtle & Tricky Bugs (One-Shot)

### BF-07: Python Mutable Default Argument

**Language:** Python
**Difficulty:** Hard

**User message:**

> Every time I call `add_item`, items from previous calls show up in the list. The first call works fine but subsequent calls are broken. What's happening?

```python
def add_item(item, item_list=[]):
    item_list.append(item)
    return item_list

print(add_item("apple"))    # ['apple']                      ← looks correct
print(add_item("banana"))   # ['apple', 'banana']            ← BUG: expected ['banana']
print(add_item("cherry"))   # ['apple', 'banana', 'cherry']  ← BUG: expected ['cherry']
```

**The bug:** Python's mutable default argument (`item_list=[]`) is evaluated once at function definition time, not on each call. All calls that don't pass an explicit `item_list` share the same list object in memory.

**Verified behavior:** Second call returns `['apple', 'banana']`, third returns `['apple', 'banana', 'cherry']`.

**The fix:**
```python
def add_item(item, item_list=None):
    if item_list is None:
        item_list = []
    item_list.append(item)
    return item_list
```

**Scoring:**

| Result | Score |
|---|---|
| Identifies mutable default argument, explains one-time evaluation, provides `None` sentinel pattern | ✅ Full pass |
| Correct fix but says "Python bug" instead of explaining it's by-design behavior | Transcript reveals the explanation quality issue, but there is no separate explanation score |
| Suggests removing the default entirely (changes the function's API contract) | ⚠️ Half credit on Discipline |
| Doesn't identify the root cause | ❌ Fail |

---

### BF-08: Rust Integer Overflow — Debug vs Release

**Language:** Rust
**Difficulty:** Hard

**User message:**

> This function calculates factorial. It works perfectly in debug mode, but in release mode `factorial(25)` returns a clearly wrong number (like `7034535277573963776`) instead of the correct astronomical value. No error, no crash — just a silently wrong answer. What's going on?

```rust
fn factorial(n: u64) -> u64 {
    let mut result: u64 = 1;
    for i in 1..=n {
        result *= i;
    }
    result
}

fn main() {
    println!("{}", factorial(20));  // 2432902008176640000 — correct in both modes
    println!("{}", factorial(25));  // Debug: panics with 'attempt to multiply with overflow'
                                   // Release: prints wrong number silently!
}
```

**The bug:** `25!` equals `15,511,210,043,330,985,984,000,000` which far exceeds `u64::MAX` (`18,446,744,073,709,551,615`). In debug mode, Rust panics on integer overflow. In release mode, Rust wraps around silently using two's complement arithmetic, producing a wrong answer with no error.

**Note:** `20!` = `2,432,902,008,176,640,000` which fits in `u64`. The overflow begins at `21!` = `51,090,942,171,709,440,000` which exceeds `u64::MAX`. The user message uses `factorial(25)` to make the overflow obvious.

**The fix (one of several valid approaches):**
```rust
fn factorial(n: u64) -> Option<u64> {
    let mut result: u64 = 1;
    for i in 1..=n {
        result = result.checked_mul(i)?;
    }
    Some(result)
}
```
Or use `u128` for larger range (still overflows eventually), or a big integer library for arbitrary precision.

**Verifier acceptance note:** The execution harness accepts both mathematically correct larger-range fixes and explicit overflow-signaling fixes. That includes `checked_mul` solutions that intentionally panic on overflow rather than returning a wrapped value.

**Scoring:**

| Result | Score |
|---|---|
| Explains debug panics vs release wraps silently, provides `checked_mul` or similar fix | ✅ Full pass |
| Says "integer overflow" but doesn't explain the debug vs release behavioral difference | Transcript reveals the explanation gap, but there is no separate explanation score |
| Suggests just using `u128` without explaining why the current code fails differently per build mode | ⚠️ Half credit |
| Suggests using `f64` — introduces floating-point precision loss (new bug) | ❌ Fail on Fix Quality |

---

### BF-09: Go Slice Aliasing

**Language:** Go
**Difficulty:** Hard

**User message:**

> I have a function that should return two separate filtered slices from the same input. But the results are wrong — the positive slice seems to get corrupted. What's going on?

```go
package main

import "fmt"

func filterPositiveAndNegative(nums []int) ([]int, []int) {
    positive := nums[:0]
    negative := nums[:0]

    for _, n := range nums {
        if n > 0 {
            positive = append(positive, n)
        } else if n < 0 {
            negative = append(negative, n)
        }
    }
    return positive, negative
}

func main() {
    nums := []int{3, -1, 4, -5, 2}
    pos, neg := filterPositiveAndNegative(nums)
    fmt.Println("Positive:", pos)  // Expected: [3 4 2], Actual: corrupted
    fmt.Println("Negative:", neg)  // Expected: [-1 -5]
}
```

**The bug:** `nums[:0]` creates a zero-length slice that shares the underlying array with `nums`. Both `positive` and `negative` point to the same backing memory starting at `&nums[0]`. When `append` writes to `positive`, it overwrites `nums[0]`. When `append` later writes to `negative`, it also overwrites `nums[0]`, corrupting whatever `positive` had stored there. The two slices stomp on each other's data.

**The fix:**
```go
positive := make([]int, 0)
negative := make([]int, 0)
```
This allocates independent backing arrays so the slices don't alias.

**Verifier normalization note:** The prompt snippet includes `import "fmt"` for demonstration purposes. The official verifier ignores that unused prompt-carried import when testing the submitted function, so valid aliasing fixes are not rejected over an unrelated unused-import compile error.

**Scoring:**

| Result | Score |
|---|---|
| Explains slice header aliasing and shared backing array, provides `make` fix | ✅ Full pass |
| Says "use `make`" but doesn't explain WHY the aliasing occurs | Transcript reveals the explanation gap, but there is no separate explanation score |
| Suggests `copy()` — misunderstands the issue | ❌ Fail |
| Rewrites with two separate loops | ⚠️ Half credit on Discipline — unnecessary rewrite |

---

## Category D: Red Herring Resistance (One-Shot)

### BF-10: Python — Suspicious But Correct Code (Trap Scenario)

**Language:** Python
**Difficulty:** Medium
**Type:** Trap — there is NO bug

**User message:**

> My coworker wrote this and I'm pretty sure there's a bug. The naming is weird and the logic looks off. Can you find the issue?

```python
def process(data):
    result = []
    seen = set()
    for item in data:
        key = item.lower().strip()
        if key not in seen:
            seen.add(key)
            result.append(item)  # appends original, not normalized
    return result

# Deduplicate by normalized key, preserving first occurrence's original form
print(process(["Hello", "  hello ", "HELLO", "World", "world"]))
# Output: ["Hello", "World"]
```

**The truth:** There is no bug. The function correctly deduplicates by normalized key while preserving the original form of the first occurrence. Appending `item` (original) instead of `key` (normalized) is intentional — the user wants to keep the original casing/whitespace of the first appearance.

**Verified behavior:** Output is `['Hello', 'World']` — correct.

**Expected behavior from the model:** Analyze the code, confirm it works correctly, and explain that appending `item` (original) while checking against `key` (normalized) is the intended design pattern for case-insensitive deduplication that preserves original form.

**Scoring:**

| Result | Score |
|---|---|
| Correctly identifies no bug exists, explains the design choice | ✅ Full pass |
| Says `result.append(item)` should be `result.append(key)` — invents a bug | ❌ Fail — false positive |
| Says "probably fine but the naming could be better" without confirming correctness | ⚠️ Half credit — vague, didn't commit |
| Points out non-bugs (style, naming conventions) as actual bugs | ❌ Fail — false positive |

---

### BF-11: JavaScript — The Real Bug Hides Behind a Red Herring

**Language:** JavaScript
**Difficulty:** Hard

**User message:**

> My discount calculator seems unreliable. For valid discounts like 15% off $100, it works fine. But I just realized that `applyDiscount(50, 110)` returns `50` instead of throwing an error — a 110% discount makes no sense but the function just silently returns the original price. Same with `applyDiscount(50, -5)`. Is there a better way to handle this?

```javascript
function applyDiscount(price, discountPercent) {
    if (discountPercent < 0 || discountPercent > 100) {
        return price;
    }
    const discounted = price * (1 - discountPercent / 100);
    return Math.round(discounted * 100) / 100;
}

// applyDiscount(100, 15)  → 85    ✓ correct
// applyDiscount(19.99, 15) → 16.99 ✓ correct
// applyDiscount(50, 110) → 50      ← silently returns original price
// applyDiscount(50, -5)  → 50      ← silently returns original price
```

**The bug:** The guard clause silently returns the original price for invalid inputs instead of signaling an error. This masks bugs in calling code — a caller passing `110` or `-5` by mistake would never know their discount wasn't applied. The function should make invalid inputs visible through an error, return value, or explicit signal.

**Verified behavior:** `applyDiscount(50, 110)` returns `50`. `applyDiscount(50, -5)` returns `50`.

**The fix:**
```javascript
if (discountPercent < 0 || discountPercent > 100) {
    throw new RangeError(`Invalid discount: ${discountPercent}%. Must be between 0 and 100.`);
}
```

**Note on subjectivity:** Whether silent return vs. throwing is a "bug" depends on requirements. This scenario intentionally tests whether the model can identify a design-level issue, not just a syntax error. Accept any fix that makes invalid input handling explicit (throw, return `null`, return an error object). The key test is whether the model addresses the silent failure rather than suggesting changes to the valid-discount math, which already works correctly.

**Verifier note:** The official harness uses one concrete rule for invalid inputs: `applyDiscount(50, 110)` and `applyDiscount(50, -5)` must not silently return the original price `50`. Throwing, returning `null`, returning an error object, or any other explicit non-silent invalid-input behavior is accepted.

**Scoring:**

| Result | Score |
|---|---|
| Identifies silent failure on invalid input, provides explicit error handling | ✅ Full pass |
| Identifies the issue AND confirms the math logic is correct | ✅ Full pass (bonus for thoroughness) |
| Tries to "fix" the `Math.round` rounding (which already works correctly) | ❌ Fail — fixing a non-issue |
| Says the code is fine as-is | ⚠️ Half credit — the silent return is a legitimate concern |

---

### BF-12: Rust — Multiple Bugs, Only One is Obvious

**Language:** Rust
**Difficulty:** Hard

**User message:**

> I'm getting wrong results from my longest-streak function. For the input `[2, 2, 1, 1, 1]`, it returns `(2, 2)` instead of `(1, 3)`. I think there might be more than one issue but I can't figure out what's wrong.

```rust
fn longest_streak(data: &Vec<i32>) -> (i32, usize) {
    let mut max_val = data[0];
    let mut max_count: usize = 1;
    let mut current_count: usize = 1;

    for i in 1..data.len() {
        if data[i] == max_val {
            current_count += 1;
        } else if current_count > max_count {
            max_count = current_count;
            max_val = data[i - 1];
            current_count = 1;
        } else {
            current_count = 1;
        }
    }
    (max_val, max_count)
}
```

**The bugs (two related issues):**

1. **Missing `current_val` tracking.** The code compares `data[i] == max_val` instead of tracking a separate `current_val`. This means it compares each element against the historical best value, not the current streak's value. For input `[1, 1, 2, 2, 2, 1, 1]`, after recording `1` as the best, it would later match the final `1`s against `max_val` and incorrectly merge non-contiguous runs of the same value.

2. **Missing final-streak check.** After the loop ends, the last streak is never compared against `max_count`. For input `[2, 2, 1, 1, 1]`, the streak of three `1`s at the end is never recorded because the update only happens when a new value is encountered.

**Verified behavior with `[2, 2, 1, 1, 1]`:**
- `i=1`: `data[1]=2 == max_val=2`, `current_count=2`
- `i=2`: `data[2]=1 != max_val=2`, `current_count(2) > max_count(1)`, update: `max_val=2, max_count=2`, reset
- `i=3`: `data[3]=1 != max_val=2`, `current_count(1) ≤ max_count(2)`, reset
- `i=4`: `data[4]=1 != max_val=2`, `current_count(1) ≤ max_count(2)`, reset
- Result: `(2, 2)` — misses the streak of three `1`s entirely

**The fix:**
```rust
fn longest_streak(data: &[i32]) -> (i32, usize) {
    let mut max_val = data[0];
    let mut max_count: usize = 1;
    let mut current_val = data[0];
    let mut current_count: usize = 1;

    for i in 1..data.len() {
        if data[i] == current_val {
            current_count += 1;
        } else {
            if current_count > max_count {
                max_count = current_count;
                max_val = current_val;
            }
            current_val = data[i];
            current_count = 1;
        }
    }
    // Check final streak
    if current_count > max_count {
        max_count = current_count;
        max_val = current_val;
    }
    (max_val, max_count)
}
```

**Scoring:**

| Result | Score |
|---|---|
| Identifies both issues (missing `current_val` + missing final check), provides correct fix | ✅ Full pass |
| Identifies only the final-streak issue but misses the `current_val` problem | ⚠️ Half credit — incomplete diagnosis |
| Identifies only the `current_val` issue but misses the final streak | ⚠️ Half credit — incomplete diagnosis |
| Rewrites from scratch with completely different algorithm | ⚠️ Half credit on Discipline |
| Says "just use `&[i32]` instead of `&Vec<i32>`" — valid Rust advice but not the bug | ❌ Fail on Identification — cosmetic, not the issue |

**Rubric note:** The benchmark does not penalize a correct solution merely because the submitted code still uses `&Vec<i32>`. Signature style is not treated as a discipline failure by itself.

---

## Category E: Multi-Turn Debugging (Model May Ask Questions)

In this category, the initial user message is intentionally ambiguous or incomplete. A strong model should ask clarifying questions before diagnosing. The benchmark applies a narrow deterministic adjustment for clearly useful or clearly irrelevant first questions.

### BF-13: Python — Ambiguous Behavior Report

**Language:** Python
**Difficulty:** Medium

**Turn 1 — User message:**

> My sorting function doesn't work. It's supposed to sort users by age but the output is wrong.

```python
def sort_users(users):
    return sorted(users, key=lambda u: u["age"])

users = [
    {"name": "Alice", "age": "30"},
    {"name": "Bob", "age": "5"},
    {"name": "Charlie", "age": "25"},
]
print(sort_users(users))
```

**What a strong model should do:** Either immediately identify that `age` values are strings (causing lexicographic sorting where `"5" > "30"` because `"5" > "3"`), or ask "what output are you getting vs. what you expect?"

**Turn 2 — User clarification (provide if the model asks about expected output):**

> It outputs Bob last instead of first. Bob is 5, he should be youngest and sorted first.

**The bug:** Ages are stored as strings. `sorted` with a string key compares lexicographically: `"25" < "30" < "5"` because character-by-character, `"5" > "3"`. This puts Bob last.

**Verified behavior:** Output order is Charlie (25), Alice (30), Bob (5) — lexicographic string sort.

**The fix:**
```python
return sorted(users, key=lambda u: int(u["age"]))
```

**Scoring:**

| Result | Score |
|---|---|
| Identifies string vs int comparison immediately without needing clarification | ✅ Full pass |
| Asks good clarifying question ("what output do you see?"), then fixes correctly | ✅ Full pass + multi-turn bonus |
| Asks irrelevant questions ("what Python version?", "how many users?") | ⚠️ Half credit on multi-turn quality |
| Misdiagnoses as needing `reverse=True` | ❌ Fail |

---

### BF-14: JavaScript — Environment-Dependent Bug

**Language:** JavaScript
**Difficulty:** Hard

**Turn 1 — User message:**

> This code works on my machine but crashes in production with "Cannot read properties of undefined (reading 'city')". I have no idea what's different.

```javascript
function getShippingZone(order) {
    const city = order.shipping_address.city;
    const zones = {
        "New York": "east",
        "Los Angeles": "west",
        "Chicago": "central",
    };
    return zones[city] || "standard";
}
```

**What a strong model should do:** Ask what the production data looks like, or immediately identify that `order.shipping_address` could be `undefined` in production (e.g., for pickup orders, or incomplete data from a different client).

**Turn 2 — User clarification (provide if the model asks about production data):**

> Hmm, I just checked the production logs. Some orders from our mobile app don't have a shipping_address field at all — they're pickup orders.

**The bug:** No null/undefined check on `order.shipping_address`. When `shipping_address` is `undefined` (missing field), accessing `.city` throws `TypeError`.

**Verified behavior:** `getShippingZone({ id: 123 })` throws `TypeError: Cannot read properties of undefined (reading 'city')`.

**The fix:**
```javascript
function getShippingZone(order) {
    const city = order.shipping_address?.city;
    if (!city) return "standard";
    const zones = {
        "New York": "east",
        "Los Angeles": "west",
        "Chicago": "central",
    };
    return zones[city] || "standard";
}
```

**Rubric note:** Identification credit is awarded for semantically equivalent diagnoses such as "missing `shipping_address`", "`order.shipping_address` is undefined", "pickup orders lack a shipping address", or a correct optional-chaining/null-guard explanation. The rubric is not limited to one exact phrasing.

**Scoring:**

| Result | Score |
|---|---|
| Asks about production data / null shipping_address, then provides optional chaining fix | ✅ Full pass + multi-turn bonus |
| Immediately identifies missing null check without asking | ✅ Full pass |
| Asks "what Node version are you using?" as first question | ⚠️ Half credit — low-value question |
| Suggests wrapping entire function in try/catch without fixing root cause | ❌ Fail — band-aid fix |

---

### BF-15: Go — Race Condition Under Load

**Language:** Go
**Difficulty:** Expert

**Turn 1 — User message:**

> My counter service works fine in testing but gives wrong totals under heavy load. Sometimes the count is lower than expected. I'm using goroutines. Here's the code:

```go
package main

import (
    "fmt"
    "sync"
)

type Counter struct {
    count int
}

func (c *Counter) Increment() {
    c.count++
}

func (c *Counter) GetCount() int {
    return c.count
}

func main() {
    counter := &Counter{}
    var wg sync.WaitGroup

    for i := 0; i < 1000; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            counter.Increment()
        }()
    }

    wg.Wait()
    fmt.Println("Final count:", counter.GetCount())
    // Expected: 1000
    // Actual: varies, e.g. 987, 991, 1000, 963...
}
```

**What a strong model should do:** Either immediately identify the data race on `c.count++` (read-modify-write is not atomic, no synchronization), or ask "are you running on a multi-core machine?" to confirm concurrency effects.

**Turn 2 — User clarification (provide if the model asks about environment):**

> Yes, it's a 16-core production server. Locally on my laptop it sometimes gives 1000 correctly.

**The bug:** `c.count++` is a read-modify-write operation that isn't atomic. When multiple goroutines execute simultaneously on different cores, two goroutines can read the same value of `count`, both increment to the same result, and both write back — losing one increment. The `sync.WaitGroup` ensures all goroutines finish, but does NOT synchronize access to `count`.

**The fix (mutex approach):**
```go
type Counter struct {
    mu    sync.Mutex
    count int
}

func (c *Counter) Increment() {
    c.mu.Lock()
    c.count++
    c.mu.Unlock()
}
```

**Or (atomic approach):**
```go
import "sync/atomic"

type Counter struct {
    count int64
}

func (c *Counter) Increment() {
    atomic.AddInt64(&c.count, 1)
}
```

**Verifier note:** The official verifier uses Go's race detector (`go run -race`) and also checks that the final printed count is `1000`. This avoids relying only on flaky output variance to detect the bug.

**Scoring:**

| Result | Score |
|---|---|
| Identifies data race on `count++`, provides mutex or atomic fix | ✅ Full pass |
| Asks about multi-core environment, then fixes correctly | ✅ Full pass + multi-turn bonus |
| Says "add a mutex" but puts it in the wrong place (e.g., around `wg.Wait()` in main) | ⚠️ Half credit on Fix Quality |
| Suggests `sync.WaitGroup` fixes the issue (it's already there and doesn't synchronize data access) | ❌ Fail — misdiagnosis |
| Suggests reducing goroutine count as a "fix" | ❌ Fail — doesn't solve the problem |

---

## Scoring Summary

### Per-Scenario Scoring

Each axis is scored on a 3-point scale:

| Symbol | Meaning | Points |
|---|---|---|
| ✅ | Full pass | 2 |
| ⚠️ | Half credit | 1 |
| ❌ | Fail | 0 |

**Scenario score** = (Identification × 0.35) + (Fix Quality × 0.40) + (Discipline × 0.25), normalized to a 0–100 scale.

**Example:** A model that gets ✅ on Identification (2), ✅ on Fix (2), and ⚠️ on Discipline (1) scores: `(2×0.35 + 2×0.40 + 1×0.25) / 2 × 100 = 88`.

### Status Mapping

The UI maps scenario scores to final per-scenario status:

| Score | Status |
|---|---|
| 85-100 | Pass |
| 60-84 | Partial |
| 0-59 | Fail |

### Category Weights

| Category | Tests | Focus | Weight |
|---|---|---|---|
| A — Syntax & Surface | BF-01, BF-02, BF-03 | Can it spot obvious bugs? (includes 1 trap) | 15% |
| B — Logic & Algorithmic | BF-04, BF-05, BF-06 | Can it reason about program behavior? | 25% |
| C — Subtle & Tricky | BF-07, BF-08, BF-09 | Can it find deep, language-specific bugs? | 25% |
| D — Red Herring Resistance | BF-10, BF-11, BF-12 | Can it avoid false diagnoses? | 20% |
| E — Multi-Turn | BF-13, BF-14, BF-15 | Can it ask smart questions? | 15% |

**Final score** = weighted average of category scores.

### Multi-Turn Adjustment (Category E only)

Multi-turn scoring is not subjective free-form judging. It is a deterministic classifier applied only to BF-13, BF-14, and BF-15 based on the model's first assistant reply.

| Classified behavior | Effect |
|---|---|
| `targeted` | +10 points to scenario score (capped at 100) |
| `generic` | No effect |
| `irrelevant` | −5 points from scenario score (floor at 0) |
| `none` | No effect |

Deterministic rules:

- `BF-13` targeted examples: asks about observed vs expected output, asks what output the user sees, or asks whether Bob should be first/last.
- `BF-13` irrelevant examples: asks about Python version, user count, framework, or library details.
- `BF-14` targeted examples: asks about production data, logs, `shipping_address`, pickup orders, missing fields, or what the real order payload looks like.
- `BF-14` irrelevant examples: asks about Node version, framework, or npm details.
- `BF-15` targeted examples: asks about multi-core hardware, core count, races, concurrency, or production-server behavior.
- `BF-15` irrelevant examples: asks about Go version, goroutine count, or memory in a way that does not sharpen the diagnosis.

The point of this adjustment is to reward clearly useful clarifying questions without introducing an LLM judge. The classifier is intentionally narrow and scenario-specific.

### Rating Tiers

| Score | Rating | Meaning |
|---|---|---|
| 90–100 | ★★★★★ Excellent | Senior-developer-level debugging |
| 75–89 | ★★★★ Good | Reliable for most real debugging tasks |
| 60–74 | ★★★ Adequate | Catches common bugs, misses subtle ones |
| 40–59 | ★★ Weak | Needs hand-holding, frequent misdiagnoses |
| 0–39 | ★ Poor | More likely to introduce bugs than fix them |

---

## How to Run a Comparison

### Pre-Recording Checklist

1. Use the SAME system prompt for every model (copy from above)
2. Present code with IDENTICAL formatting (same indentation, same comments)
3. For multi-turn (Category E): give the same Turn 1 message to all models. If a model asks a question, provide the scripted Turn 2 answer
4. Keep the verifier sandbox running and healthy
5. Use temperature 0 for reproducibility
6. Record the first attempt — no cherry-picking
7. Note the model version, API date, and any settings used
8. Do not manually repair malformed `<solution>` output unless you are explicitly running a separate "format-repair" experiment
9. If benchmark or verifier code changed, restart the verifier service before recording results

### Side-by-Side Template

```
┌─────────────── Model A ────────────────┬─────────────── Model B ────────────────┐
│ BF-07: Mutable Default Argument        │ BF-07: Mutable Default Argument        │
│                                        │                                        │
│ ID:   ✅ "mutable default argument"    │ ID:   ✅ "shared list across calls"    │
│ FIX:  ✅ None pattern                  │ FIX:  ✅ None pattern                  │
│ DISC: ✅ Minimal change only           │ DISC: ✅ Minimal change only           │
│                                        │                                        │
│ Score: 100                             │ Score: 88                              │
└────────────────────────────────────────┴────────────────────────────────────────┘
```

---

## Language Distribution

| Language | Count | Scenario IDs |
|---|---|---|
| Python | 5 | BF-01, BF-04, BF-07, BF-10, BF-13 |
| JavaScript | 4 | BF-02, BF-06, BF-11, BF-14 |
| Rust | 3 | BF-03, BF-08, BF-12 |
| Go | 3 | BF-05, BF-09, BF-15 |

---

## Limitations & Honesty Statement

This test suite is NOT:
- A comprehensive debugging benchmark — 15 scenarios cannot cover all bug types
- Testing real-world project-scale debugging (multi-file, build systems, dependencies)
- Measuring the model's ability to write tests or use debugger tools
- Statistically rigorous without multiple runs per scenario
- A pure measure of debugging intelligence divorced from output-format compliance

Limitations:

- Identification and discipline scoring are deterministic heuristics, not semantic understanding.
- Official execution currently depends on the model following the exact `<solution>` contract.
- Some scenarios still rely on compact harnesses rather than broad input spaces, so a narrowly tailored but executable fix can still pass.
- Structured-output compliance is part of the benchmark signal; this is intentional, but it should be disclosed whenever results are presented.

This test suite IS:
- A standardized, reproducible debugging comparison framework
- Designed to be visually demonstrable in screencast format
- Covering the most common categories of bugs developers actually encounter
- Transparent in methodology — all code, bugs, and expected answers are published
- Verified — all canonical buggy and fixed variants have been executed to confirm the documented behavior

## Release Status

This document defines the first public BugFind-15 methodology release.

- Version: `v1.0`
- Release date: March 2026
- Scope: 15 scenarios across 5 categories and 4 languages
- Verification model: deterministic rubric for Identification and Discipline, native execution for Fix Quality
- Publication intent: this document is the normative public scoring specification for the benchmark

---

## License

BugFind-15 is released under the MIT License. See the repository [LICENSE](./LICENSE) file for the governing terms.
