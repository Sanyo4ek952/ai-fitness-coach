// Isolated synthetic fixture for manual production checks. Never served by the
// app, never overwrites a database that already has records.
const id = () => crypto.randomUUID();
const createdAt = "2026-11-24T00:00:00Z";
const profile = { id: id(), revision: 1, goal: "Синтетическая проверка M3-02", experience: "unknown", sessionsPerWeek: null, equipment: ["dumbbells", "bodyweight", "treadmill"], nutritionOptIn: false };
const workouts = ["A", "B"].map((title) => ({ id: id(), title: `Тест ${title}`, exercises: [
  { id: id(), exerciseId: "goblet-squat", sets: 2, target: { type: "reps", min: 6, max: 8, weightKg: null }, restSec: 60 },
  { id: id(), exerciseId: "plank", sets: 1, target: { type: "duration", seconds: 20 }, restSec: 30 },
  { id: id(), exerciseId: "treadmill-walk", sets: 1, target: { type: "distance", meters: 100 }, restSec: 30 },
] }));
const program = { id: id(), revision: 1, previousId: null, profileRevision: 1, createdAt, title: "Синтетическая программа M3-02", goalInterpretation: "Проверка интерфейса, не рекомендация", workouts, reviewAfterSessions: 2 };
export const setSeedHtml = `<!doctype html><html lang="ru"><meta charset="utf-8"><title>Тестовая фикстура M3-02</title><body><h1>Синтетические данные M3-02</h1><p id="status">Подготовка…</p><a href="/">Открыть тренировку</a><script>
const req=indexedDB.open('ai-fitness-coach');
req.onupgradeneeded=()=>{const db=req.result;for(const [name,key] of Object.entries({profileRevisions:'revision',programVersions:'id',sessions:'id',counters:'key',coachRequests:'requestId',coachResponses:'requestId',programState:'key',coachAcceptances:'requestId'})){const store=db.createObjectStore(name,{keyPath:key});if(name==='programVersions')store.createIndex('revision','revision',{unique:true});if(name==='sessions')store.createIndex('status','status')}};
req.onsuccess=()=>{const db=req.result;const tx=db.transaction(['profileRevisions','programVersions','programState','sessions'],'readwrite');let seeded=false;const count=tx.objectStore('profileRevisions').count();count.onsuccess=()=>{if(count.result)return;seeded=true;tx.objectStore('profileRevisions').add({revision:1,payload:${JSON.stringify(profile)}});tx.objectStore('programVersions').add({id:'${program.id}',revision:1,payload:${JSON.stringify(program)}});tx.objectStore('programState').add({key:'activeProgram',payload:{programVersionId:'${program.id}',nextWorkoutIndex:0}})};tx.oncomplete=()=>{document.getElementById('status').textContent=seeded?'Готово: тестовая программа, без фактов.':'Данные уже есть; ничего не изменено.';db.close()};tx.onerror=()=>{document.getElementById('status').textContent='Ошибка: '+tx.error;db.close()}};
</script></body></html>`;

export const setFactsHtml = `<!doctype html><html lang="ru"><meta charset="utf-8"><title>Сохранённые факты M3-02</title><body><h1>Тест: факты из IndexedDB</h1><pre id="facts"></pre><a href="/">Тренировка</a><script>
const req=indexedDB.open('ai-fitness-coach');req.onsuccess=()=>{const db=req.result;const tx=db.transaction(['sessions','counters','programState']);const data={};for(const table of ['sessions','counters','programState']){const r=tx.objectStore(table).getAll();r.onsuccess=()=>data[table]=r.result}tx.oncomplete=()=>{document.getElementById('facts').textContent=JSON.stringify(data,null,2);db.close()}};
</script></body></html>`;
