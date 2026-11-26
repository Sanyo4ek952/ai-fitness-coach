import { runStorageCase, storageCases } from "../storage-cases";
import { sessionLifecycleCases } from "../session-lifecycle-cases";
const cases = [...storageCases, ...sessionLifecycleCases];

const button = document.querySelector("button");
const results = document.querySelector("pre");
if (!button || !results) throw new Error("Нет элементов тестовой страницы");
button.addEventListener("click", async () => {
  button.disabled = true;
  results.textContent = `Native IndexedDB: ${navigator.userAgent}\n`;
  let passed = 0;
  for (const test of cases) {
    try {
      await runStorageCase(test); passed++;
      results.textContent += `PASS ${test.name}\n`;
    } catch (error) { results.textContent += `FAIL ${test.name}: ${String(error)}\n`; }
  }
  results.textContent += `ИТОГ: ${passed}/${cases.length}`;
  button.disabled = false;
});
