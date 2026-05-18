import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SCENARIOS, type ScenarioState } from "./benchmark";

const sandboxPass = {
  status: "pass" as const,
  scenarioId: "test",
  summary: "Sandbox verified a runnable fix via candidate.",
  candidate: { label: "tagged-solution", source: "solution_tag" },
  candidatesTried: 1,
  results: []
};

describe("SCENARIOS regression scoring", () => {
  it("should pass BF-03 when the model says the code compiles as-is and uses no_bug", () => {
    // Arrange
    const scenario = getScenario("BF-03");
    const state = stateFor(`The code shown should compile as-is. \`format!("Hello, {}", name)\` does **not** move \`name\`; formatting macros borrow their arguments for display formatting. So \`name\` is still available for the later \`println!\`.

If you are seeing “value used here after move,” the actual code likely has something else that moves \`name\`, such as assigning it to another variable, passing it to a function that takes \`String\`, or using it without borrowing.

<solution language="rust" verdict="no_bug"></solution>`, {
      ...sandboxPass,
      scenarioId: "BF-03",
      candidate: { label: "tagged-no-bug", source: "solution_tag_no_bug" }
    });

    // Act
    const result = scenario.evaluate(state);

    // Assert
    assert.equal(result.status, "pass");
    assert.equal(result.score, 100);
    assert.deepEqual(result.axes, { identification: 2, fixQuality: 2, discipline: 2 });
  });

  it("should pass BF-01 when the model explains the loop goes out of range and provides a direct iteration fix", () => {
    // Arrange
    const scenario = getScenario("BF-01");
    const state = stateFor(`You’re getting \`IndexError\` because the loop starts at \`1\` and goes through \`len(numbers)\`, so it tries to access \`numbers[len(numbers)]\`, which is out of range.

<solution language="python" verdict="fix">
def sum_list(numbers):
    total = 0
    for num in numbers:
        total += num
    return total
</solution>`, { ...sandboxPass, scenarioId: "BF-01" });

    // Act
    const result = scenario.evaluate(state);

    // Assert
    assert.equal(result.status, "pass");
    assert.equal(result.score, 100);
  });

  it("should pass BF-04 when the model says deleting entries while iterating changes dictionary size", () => {
    // Arrange
    const scenario = getScenario("BF-04");
    const state = stateFor(`The bug occurs on this line: \`for user_id, status in users.items():\`

Python does not allow modifying the size of a dictionary while iterating over it. When \`del users[user_id]\` is called, the dictionary shrinks, which breaks the internal iterator and raises a \`RuntimeError\`.

<solution language="python" verdict="fix">
def remove_inactive_users(users):
    for user_id, status in list(users.items()):
        if status == "inactive":
            del users[user_id]
    return users
</solution>`, { ...sandboxPass, scenarioId: "BF-04" });

    // Act
    const result = scenario.evaluate(state);

    // Assert
    assert.equal(result.status, "pass");
    assert.equal(result.score, 100);
  });

  it("should pass BF-06 when the model says fetch returns a Promise and both calls must be awaited", () => {
    // Arrange
    const scenario = getScenario("BF-06");
    const state = stateFor(`\`fetch()\` is asynchronous. In your code, \`response\` is a Promise, not the actual Response object, so \`response.json()\` fails because Promises don’t have a \`.json()\` method. \`response.json()\` is also asynchronous, so that result must be awaited too.

<solution language="javascript" verdict="fix">
async function getUserName(userId) {
    const response = await fetch(\`/api/users/${"${userId}"}\`);
    const data = await response.json();
    return data.name;
}
</solution>`, { ...sandboxPass, scenarioId: "BF-06" });

    // Act
    const result = scenario.evaluate(state);

    // Assert
    assert.equal(result.status, "pass");
    assert.equal(result.score, 100);
  });

  it("should still fail BF-03 when the model invents an ownership fix", () => {
    // Arrange
    const scenario = getScenario("BF-03");
    const state = stateFor(`The move happens in \`format!("Hello, {}", name)\`. Use \`&name\` so ownership stays with \`name\`.

<solution language="rust" verdict="fix">
fn main() {
    let name = String::from("Alice");
    let greeting = format!("Hello, {}", &name);
    println!("{}", greeting);
    println!("Name was: {}", name);
}
</solution>`, {
      status: "fail",
      scenarioId: "BF-03",
      summary: "Trap scenarios must use verdict=\"no_bug\" with an empty solution block.",
      candidatesTried: 0,
      results: []
    });

    // Act
    const result = scenario.evaluate(state);

    // Assert
    assert.equal(result.status, "fail");
    assert.equal(result.score, 0);
  });

  it("should still fail BF-10 when the model changes preserved original values to normalized keys", () => {
    // Arrange
    const scenario = getScenario("BF-10");
    const state = stateFor(`The bug is that it appends the original item. Change to key so the result contains normalized values.

<solution language="python" verdict="fix">
def process(data):
    result = []
    seen = set()
    for item in data:
        key = item.lower().strip()
        if key not in seen:
            seen.add(key)
            result.append(key)
    return result
</solution>`, {
      status: "fail",
      scenarioId: "BF-10",
      summary: "Trap scenarios must use verdict=\"no_bug\" with an empty solution block.",
      candidatesTried: 0,
      results: []
    });

    // Act
    const result = scenario.evaluate(state);

    // Assert
    assert.equal(result.status, "fail");
    assert.equal(result.score, 0);
  });
});

function getScenario(id: string) {
  const scenario = SCENARIOS.find((candidate) => candidate.id === id);
  assert.ok(scenario, `Expected scenario ${id} to exist.`);
  return scenario;
}

function stateFor(assistantMessage: string, executionResult: unknown = sandboxPass): ScenarioState {
  return {
    assistantMessages: [assistantMessage],
    finalAnswer: assistantMessage,
    conversation: [],
    meta: { executionResult }
  };
}
