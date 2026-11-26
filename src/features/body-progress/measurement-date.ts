/** Local calendar date, without a narrow native date/time composite control. */
export function measurementDateInput(date = new Date()) {
  return `${String(date.getDate()).padStart(2, "0")}.${String(date.getMonth() + 1).padStart(2, "0")}.${date.getFullYear()}`;
}
export function parseMeasurementDate(input: string) {
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(input.trim());
  if (!match) throw new Error("Укажите дату в формате ДД.ММ.ГГГГ");
  const day = Number(match[1]), month = Number(match[2]), year = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) throw new Error("Такой даты нет в календаре");
  return date.toISOString();
}
