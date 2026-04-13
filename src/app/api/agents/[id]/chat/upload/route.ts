import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * POST /api/agents/[id]/chat/upload — Upload a file to the chat
 * Stores the file content in the knowledge base and returns a reference
 * that can be included in the next chat message for Claude to read.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: agentId } = await params;
  const orgId = (session.user as any).orgId;

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });

  const maxSize = 10 * 1024 * 1024; // 10MB
  if (file.size > maxSize) {
    return NextResponse.json({ error: "File too large (max 10MB)" }, { status: 400 });
  }

  const deployment = await db.agentDeployment.findFirst({
    where: { agentId, isActive: true },
    select: { projectId: true },
  });

  const bytes = await file.arrayBuffer();
  const content = Buffer.from(bytes).toString("utf-8");
  const isImage = file.type.startsWith("image/");
  const isPDF = file.type === "application/pdf";
  const isCSV = file.type === "text/csv" || file.name.endsWith(".csv");

  // For images, store as base64 data URL
  let storedContent: string;
  let fileType: string;

  if (isImage) {
    const base64 = Buffer.from(bytes).toString("base64");
    storedContent = `[Image: ${file.name}] (${file.type}, ${(file.size / 1024).toFixed(0)}KB)`;
    fileType = "IMAGE";
    // Store the base64 for Claude vision
    // Note: we'll pass this as an image content block in the next chat message
  } else if (isPDF) {
    storedContent = `[PDF: ${file.name}] (${(file.size / 1024).toFixed(0)}KB) — PDF content extraction not yet supported. Please copy-paste the relevant text.`;
    fileType = "FILE";
  } else if (isCSV) {
    storedContent = content.slice(0, 50000); // cap at 50KB of text
    fileType = "FILE";
  } else {
    storedContent = content.slice(0, 50000);
    fileType = "TEXT";
  }

  // Save to knowledge base
  const kbItem = await db.knowledgeBaseItem.create({
    data: {
      orgId,
      agentId,
      projectId: deployment?.projectId || null,
      layer: "PROJECT",
      type: fileType,
      title: `Chat upload: ${file.name}`,
      content: storedContent,
      mimeType: file.type,
      fileSize: file.size,
      trustLevel: "STANDARD",
      tags: ["chat_upload", file.type.split("/")[0]],
    },
  });

  // Save as a chat message so it appears in the conversation
  await db.chatMessage.create({
    data: {
      agentId,
      role: "user",
      content: `[Uploaded file: ${file.name} (${(file.size / 1024).toFixed(0)}KB, ${file.type})]`,
      metadata: {
        type: "file_upload",
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type,
        kbItemId: kbItem.id,
        isImage,
      } as any,
    },
  });

  return NextResponse.json({
    data: {
      id: kbItem.id,
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type,
      isImage,
      // For the next chat message, include this context
      contextForAgent: isImage
        ? `The user uploaded an image: ${file.name}. Acknowledge it and ask what they'd like you to do with it.`
        : `The user uploaded a file: ${file.name} (${file.type}). Here's the content:\n\n${storedContent.slice(0, 2000)}`,
    },
  });
}
