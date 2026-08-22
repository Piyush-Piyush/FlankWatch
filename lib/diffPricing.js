function unwrap(result) {
  return Array.isArray(result) ? result[0] : result;
}

/**
 * Compares two scrape results by plan_name and reports what changed —
 * powers the dashboard's diff panel and (later) the weekly digest.
 */
export function diffPricingRuns(currentResult, previousResult) {
  if (!previousResult) return [];

  const currentTiers = unwrap(currentResult)?.pricing_tiers || [];
  const previousTiers = unwrap(previousResult)?.pricing_tiers || [];

  const prevByName = new Map(previousTiers.map((t) => [t.plan_name, t]));
  const currByName = new Map(currentTiers.map((t) => [t.plan_name, t]));

  const changes = [];

  for (const [name, curr] of currByName) {
    const prev = prevByName.get(name);
    if (!prev) {
      changes.push({ type: "added", plan_name: name });
      continue;
    }
    const currPrice = curr.price?.value;
    const prevPrice = prev.price?.value;
    if (currPrice !== prevPrice) {
      changes.push({ type: "price_changed", plan_name: name, from: prevPrice, to: currPrice });
    }
  }

  for (const [name] of prevByName) {
    if (!currByName.has(name)) changes.push({ type: "removed", plan_name: name });
  }

  return changes;
}
