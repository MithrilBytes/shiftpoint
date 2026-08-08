import { prisma } from "../lib/db";

export default async function Home() {
  const notes = await prisma.note.findMany({
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  return (
    <main>
      <h1>Notes</h1>
      <ul>
        {notes.map((note) => (
          <li key={note.id}>{note.title}</li>
        ))}
      </ul>
    </main>
  );
}
