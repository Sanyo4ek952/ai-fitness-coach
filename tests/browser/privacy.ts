import { privacyCases } from "../privacy-cases";

const button = document.querySelector<HTMLButtonElement>("#run");
const results = document.querySelector("#results");
button?.addEventListener("click", () => {
  if (!results || !button) return;
  button.disabled = true; results.textContent = "Выполняется…\n";
  void (async () => {
    let passed = 0;
    for (const item of privacyCases) { await item.run(); passed++; results.textContent += `PASS ${item.name}\n`; }
    results.textContent += `PASS ${passed}/${privacyCases.length}\n`;
  })().catch((cause: unknown) => { results.textContent += `FAIL ${cause instanceof Error ? cause.stack : String(cause)}\n`; })
    .finally(() => { button.disabled = false; });
});
