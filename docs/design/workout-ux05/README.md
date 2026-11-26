# UX-05 — макеты тренировки для утверждения

Дата: 26.11.2026. Макеты утверждены владельцем с требованием точного воспроизведения; реализованы в UX-05. Изображения 01–05 служат визуальным эталоном; подписи вне экранов не входят в приложение. Результаты проверок — PROGRESS и TESTING.

## Приёмка дизайн-шага

Повторная сверка после замечаний: [UX06-COMPARISON](UX06-COMPARISON.md) и [UX07-COMPARISON](UX07-COMPARISON.md). Все11состояний доступны на http://127.0.0.1:4195/tests/browser/workout-compare.html, включая360px/текст200%. Справа реальные компоненты/native dialogs и только синтетические данные.

Сохранить цвета globals.css; показать подготовку, ввод подхода, компактный и крупный отдых, действия упражнения, подтверждение завершения и итог. У каждого экрана одно главное действие; план отделён от факта; кнопки от 48px. Утверждение макетов не подменяет проверку доступности на реальном телефоне.

## Решения

1. До старта: краткая сводка, список упражнений, рекомендации и порядок в раскрытиях, закреплённый старт.
2. Во время: текущее упражнение, план подхода, сохранённые факты, один редактор веса/повторов; RIR доброволен. Список остальных упражнений доступен из раскрытия, возврат не стирает черновик.
3. Отдых: закреплённая карточка над навигацией, крупные цифры, следующий подход, ±15с и завершение отдыха. Нажатие раскрывает крупный режим. Автостарт после успешного сохранения подхода — предлагаемое новое поведение, переключатель пользователя; таймер не запускается при отказе сохранения.
4. Изменение времени касается текущего отдыха, не правит программу. Окончание таймера не фиксирует подход и не запускает упражнение. Пауза таймера не добавляется: исходная модель хранит deadline. На нуле: «Отдых завершён» / «Продолжайте, когда готовы», без обязательного сигнала. Фоновые звуки/уведомления не гарантировать.
5. Замена/пропуск: отдельная панель, затем существующее подтверждение конкретного действия. План и история сохраняются.
6. Завершение: показать фактический объём и неполноту, подтвердить, только после commit показать итог. Ошибка оставляет занятие и результаты доступными для повтора. «К следующей тренировке» открывает предпросмотр, не стартует сессию.

## Не изображённые полностью состояния, обязательные при реализации

- Нет программы: одно действие «Получить программу»; профиль без повторной анкеты.
- Незавершённая сессия: сводка и «Продолжить тренировку», не второй старт.
- Загрузка/ошибка чтения: отдельные status/alert и «Повторить»; ошибка не равна пустой программе.
- Ошибка записи: введённые значения остаются, подход не отмечается сохранённым, автоотдых не стартует.
- Ноль результатов: завершение без результатов оставляет то же занятие следующим.
- Пропущенные подходы отмечаются отдельно, не входят в выполненные. Метки на макетах не заменяют доменные определения.
- Длительность и дистанция: вместо веса/повторов соответствующие поля по существующей схеме; неизвестный вес — «Подобрать вес»; помощь/вес одной гантели подписаны явно.
- Индивидуальные setPlans/restSec должны использоваться для выбранного подхода; рекомендации и переход этапа доступны отдельно, нагрузка не меняется автоматически.
- При редактировании сохранённого факта используем явное «Сохранить исправление», не стартуем отдых повторно без действия.
- Реализация требует проверки narrow360px, text200%, keyboard/focus, screenreader, offline/reload/deadline и конфликтов вкладок. Sticky блок не перекрывает поля и клавиатуру.

## Источники и граница исследования

Изучены официальные описания и иллюстрации Hevy и Strong, а не тестирование их приложений:

- https://www.hevyapp.com/features/workout-rest-timer/ — автозапуск после подхода, отдых для упражнения, корректировка времени.
- https://www.hevyapp.com/features/track-workouts/ — компактная запись подходов и нагрузок.
- https://help.strongapp.io/article/231-rest-timer — компактный индикатор и раскрытие на весь экран.

Адаптация к текущей локальной PWA сохраняет ограничения фона. Нет заимствования соцфункций/подписок/нативных гарантий.

## Артефакты и блоки для обсуждения

- 01-before-workout.png: шапка, сводка, план, раскрытия, старт, навигация.
- 02-record-set.png: ход занятия, упражнение, план/факт, ввод, сохранение, автоотдых.
- 03-rest-timer.png: компактный/крупный отдых, управление временем, следующий подход.
- 04-actions-finish.png: действия упражнения, подтверждение неполного завершения, сохранённый итог.
- 05-return-errors.png: нет программы, возврат к занятию, ошибка записи, отдых закончился. Дополнительный точный промпт — 05-states-prompt.txt.

Визуальное уточнение макета 02: обводка значений в строке таблицы не означает второй редактор. Таблица показывает план/факт, единственная форма ввода — пара крупных полей ниже. «План и техника» означает раскрытие только существующего текста плана/примечания; отдельной библиотеки техники этот шаг не вводит.

Иллюстрации содержат вымышленные данные. В рабочем приложении подставляются сохранённые названия, упражнения, число подходов, единицы и нагрузки; искусственные статус-бар телефона и рамка не рисуются. Для длинных названий, 360px, текста200% и экранной клавиатуры блоки переносятся и прокручиваются; кнопки доступны без горизонтального скролла. Стиль изолирован в features/next-workout/workout.css; CSS остальных экранов не переоформлен. Схема БД не менялась.

Автоотдых реализован optional-командой autoRest в recordSet: expectedTimer сверяется и таймер записывается вместе с фактом и historyRevision. Ошибка любого put откатывает всё. Исправление факта не запускает таймер, точный повтор после commit не перезапускает уже изменённый/снятый отдых. Переключатель действует в текущем открытом занятии. Значение ±15с относится к текущему таймеру; остаток ограничен0–600с, на0 таймер снимается. Сохраняется исходное время начала, пока интервал до нового deadline укладывается в600с; при достижении границы начало сдвигается вперёд в рамках прежней схемы. Истечение само по себе не создаёт факт. Остальные действия используют прежние CAS/транзакции.

## Промпты

Использован встроенный image_gen, без API/CLI и новых зависимостей. Ниже сохранены точные промпты.

### 1

```text
Use case: ui-mockup. Create a high fidelity Russian mobile fitness PWA UI approval image, crisp accurate Cyrillic, flat front-on screen designs, no photography, no 3D device perspective, no ornamental dashboard. Strict existing palette: canvas #040e28, cards #102342 and #112c50, border #375c8e, white text #f2f6ff, secondary #adbfdf, cyan #28d9f7, primary button royal blue #1750ff. Arial-like sans serif. Rounded 14px cards, restrained border, no excessive glow. Spacious pragmatic gym interface, legible 16px+ mobile text, 48-56px minimum buttons. Use a consistent 390px-wide phone screen proportions. All sample data synthetic. Brand 'AI Fitness Coach'. Four bottom tabs 'Тренировка', 'Прогресс', 'Тренер', 'Профиль' only where specified. Design based on a clear hierarchy with one primary action. Asset 01: Single complete tall mobile screen before starting a workout, on dark navy presentation background, small outside title '01 / Перед тренировкой'. At top small brand then h1 'Тренировка'. Hero card: eyebrow 'СЛЕДУЮЩЕЕ ЗАНЯТИЕ', title 'А · Всё тело', subtitle 'Базовая программа · Этап 1', compact metadata '4 упражнения' and '12 подходов'. Then heading 'План занятия' and 4 tidy numbered exercise rows without pictures: 'Жим ногами' subtitle '3 × 10–12 · 80 кг' and trailing chevron; 'Тяга верхнего блока' '3 × 10–12 · 35 кг'; 'Жим гантелей сидя' '3 × 10 · 12 кг / гантель'; 'Горизонтальная тяга' '3 × 12 · 30 кг'. Below 2 collapsed full width disclosure rows 'Рекомендации программы' and 'Порядок занятий · дальше Б'. Sticky bottom full-width blue button 'Начать тренировку', then bottom navigation active cyan Тренировка. Keep no large decorative hero, no estimated time unsupported by plan. All contents easy to scan. Small outside block labels along right margin referring to header, summary, exercise list, disclosures, primary action, navigation, but never overlay interface. Export polished UI design image.
```

### 2

```text
Use case: ui-mockup. Create a high fidelity Russian mobile fitness PWA UI approval image, crisp accurate Cyrillic, flat front-on screen designs, no photography, no 3D device perspective, no ornamental dashboard. Strict existing palette: canvas #040e28, cards #102342 and #112c50, border #375c8e, white text #f2f6ff, secondary #adbfdf, cyan #28d9f7, primary button royal blue #1750ff. Arial-like sans serif. Rounded 14px cards, restrained border, no excessive glow. Spacious pragmatic gym interface, legible 16px+ mobile text, 48-56px minimum buttons. Use a consistent 390px-wide phone screen proportions. All sample data synthetic. Brand 'AI Fitness Coach'. Four bottom tabs 'Тренировка', 'Прогресс', 'Тренер', 'Профиль' only where specified. Design based on a clear hierarchy with one primary action. Asset 02: Single complete tall mobile active workout screen, small outside title '02 / Запись подхода'. Compact header 'А · Всё тело' with secondary 'Упражнение 1 из 4' and discreet outlined 'Завершить' button. Thin progress line and '1 из 12 подходов'. Active large card 'Жим ногами', top secondary '3 подхода · отдых 2:00', link 'План и техника ›'. Small clearly distinct plan panel 'ПЛАН ПОДХОДА 2' and '80 кг × 10–12 · RIR 2'. Table below columns 'Подход', 'кг', 'Повторы', 'Статус'. Saved row '1', '80', '12', check with text 'Сохранён'. Active cyan outlined row '2', editable input '80', editable input '10', short 'Сейчас'. Future row '3', '80', '10–12', dash, visually muted. Beneath large stepper input panels labelled 'Вес, кг' and 'Повторы' each with minus and plus touch controls value80 and10. Collapsed optional row 'Запас повторов (RIR) · по желанию'. Main blue full-width button 'Сохранить подход'. Secondary text 'После сохранения — отдых 2:00' and enabled toggle labelled 'Автоотдых'. Lower collapsed row 'Все упражнения · 1 из 4' and 'Заменить или пропустить ›'. Fixed compact rest chip 'Отдых не запущен' with outlined 'Запустить 2:00'. Bottom 4tab navigation. No photographs. Avoid duplicating fields excessively: table is summary, stepper pair is sole editor. Outside small block labels, not on UI. No fake guaranteed notification features.
```

### 3

```text
Use case: ui-mockup. Create a high fidelity Russian mobile fitness PWA UI approval image, crisp accurate Cyrillic, flat front-on screen designs, no photography, no 3D device perspective, no ornamental dashboard. Strict existing palette: canvas #040e28, cards #102342 and #112c50, border #375c8e, white text #f2f6ff, secondary #adbfdf, cyan #28d9f7, primary button royal blue #1750ff. Arial-like sans serif. Rounded 14px cards, restrained border, no excessive glow. Spacious pragmatic gym interface, legible 16px+ mobile text, 48-56px minimum buttons. Use a consistent 390px-wide phone screen proportions. All sample data synthetic. Brand 'AI Fitness Coach'. Four bottom tabs 'Тренировка', 'Прогресс', 'Тренер', 'Профиль' only where specified. Design based on a clear hierarchy with one primary action. Asset 03: Landscape approval board with TWO large readable consistent mobile screens side by side, equal height. Outside heading '03 / Отдых между подходами'. Left small caption 'Компактный режим'. Left screen active workout 'А · Всё тело', header exercise1of4, active exercise card 'Жим ногами', saved sets1and2, next set3. Lower sticky card ABOVE bottom nav: title 'Отдых', giant digits '01:24', subtext 'Далее: подход 3 · 80 кг × 10–12', thin cyan progress bar, two large outlined buttons '−15 с' and '+15 с', text button 'Крупный таймер ↗' and secondary 'Закончить отдых'. Current workout content remains visible above; no modal obscuring it. Right caption 'Крупный режим'. Right screen full viewport rest mode, top left '‹ К упражнению', label 'ОТДЫХ', a restrained cyan circular arc around huge '01:24', below 'из 2:00', two large side by side outlined buttons '−15 с' '+15 с'. Next card 'СЛЕДУЮЩИЙ ПОДХОД', 'Жим ногами', 'Подход 3 из 3 · 80 кг × 10–12'. Bottom main blue button 'Закончить отдых', secondary muted accurate text 'В фоне звук может быть недоступен'. Do not show bottom navigation on fullscreen rest. Large calm easily read digits, not busy neon gamer UI. Outside board note 'Таймер раскрывается по нажатию. Окончание отдыха не записывает подход.'
```

### 4

```text
Use case: ui-mockup. Create a high fidelity Russian mobile fitness PWA UI approval image, crisp accurate Cyrillic, flat front-on screen designs, no photography, no 3D device perspective, no ornamental dashboard. Strict existing palette: canvas #040e28, cards #102342 and #112c50, border #375c8e, white text #f2f6ff, secondary #adbfdf, cyan #28d9f7, primary button royal blue #1750ff. Arial-like sans serif. Rounded 14px cards, restrained border, no excessive glow. Spacious pragmatic gym interface, legible 16px+ mobile text, 48-56px minimum buttons. Use a consistent 390px-wide phone screen proportions. All sample data synthetic. Brand 'AI Fitness Coach'. Four bottom tabs 'Тренировка', 'Прогресс', 'Тренер', 'Профиль' only where specified. Design based on a clear hierarchy with one primary action. Asset 04: Wide high resolution approval board with THREE legible mobile screens, equal height, no device frames. Outside title '04 / Действия и завершение'. Consistent design same as other assets. Screen A caption 'Действия упражнения': dimmed workout background with accessible bottom sheet title 'Жим ногами', subtitle 'Только для текущего занятия'; large rows 'Заменить упражнение ›' and 'Пропустить оставшиеся подходы ›'; body 'План программы останется прежним.' and fullwidth outlined 'Вернуться к подходу'. No destructive action automatically executed. Screen B caption 'Подтверждение завершения': full height workout shell, central card title 'Завершить тренировку?', text 'Сохранено 8 из 12 подходов', compact list 'Выполнено: 8', 'Осталось: 4'; text 'Невыполненные подходы не попадут в результаты. Следующим будет занятие Б.' blue button 'Завершить тренировку', outlined 'Продолжить тренировку', clear partial badge 'Неполная тренировка'. Screen C caption 'После успешного сохранения': h1 'Тренировка завершена', restrained cyan check icon, badge 'Выполнена частично', summary 'А · Всё тело', '8 подходов сохранено', '3 из 4 упражнений с результатами'. Disclosure row 'Посмотреть результаты ›'. Next card eyebrow 'ДАЛЬШЕ ПО ПОРЯДКУ' title 'Б · Всё тело', subtitle 'Начните, когда будете готовы'. Blue button 'К следующей тренировке' meaning return to preview only, NOT auto start. Four-tab navigation active Тренировка. No calorie claims, confetti, share buttons, charts, backend, obligatory feedback. Avoid implying skipped or incomplete sets completed.
```

