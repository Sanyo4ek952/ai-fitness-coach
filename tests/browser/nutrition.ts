import { nutritionCases } from "../nutrition-cases";
const button = document.querySelector<HTMLButtonElement>("#run");
const results = document.querySelector("#results");
button?.addEventListener("click", () => {
  if (!results) return;
  button.disabled = true; results.textContent = "";
  void nutritionCases((label) => { results.textContent += `PASS ${label}\n`; })
    .then(() => { results.textContent += "DONE 8/8"; })
    .catch((cause: unknown) => { results.textContent += `FAIL ${String(cause)}`; })
    .finally(() => { button.disabled = false; });
});
