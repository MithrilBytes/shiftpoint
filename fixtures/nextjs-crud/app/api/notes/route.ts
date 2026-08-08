import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "../../../lib/db";

const NoteInput = z.object({
  title: z.string().min(1),
  body: z.string(),
  authorId: z.string(),
});

export async function GET() {
  const notes = await prisma.note.findMany({ take: 50 });
  return NextResponse.json(notes);
}

export async function POST(request: Request) {
  const parsed = NoteInput.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid input" }, { status: 400 });
  }
  const note = await prisma.note.create({ data: parsed.data });
  return NextResponse.json(note, { status: 201 });
}
