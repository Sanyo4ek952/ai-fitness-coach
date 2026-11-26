type PlaceholderScreenProps = Readonly<{
  title: string;
  description: string;
}>;

export function PlaceholderScreen({ title, description }: PlaceholderScreenProps) {
  return (
    <>
      <h1 className="mb-4 text-3xl font-bold">{title}</h1>
      <p className="mb-4 leading-relaxed">{description}</p>
      <p className="text-sm leading-relaxed text-slate-600">
        Раздел пока недоступен. Функции появятся в следующих версиях.
      </p>
    </>
  );
}
