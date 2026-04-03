"use client";

import { useState, useCallback } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Highlight from "@tiptap/extension-highlight";
import Typography from "@tiptap/extension-typography";
import Underline from "@tiptap/extension-underline";
import TextAlign from "@tiptap/extension-text-align";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableHeader } from "@tiptap/extension-table-header";
import { TableCell } from "@tiptap/extension-table-cell";
import Placeholder from "@tiptap/extension-placeholder";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Bold, Italic, Underline as UnderlineIcon, Strikethrough, Code,
  Heading1, Heading2, Heading3, List, ListOrdered, CheckSquare,
  AlignLeft, AlignCenter, AlignRight, AlignJustify,
  Quote, Minus, Undo2, Redo2, Table as TableIcon,
  Link as LinkIcon, Image as ImageIcon, Highlighter,
  Download, Save, Eye, Edit3, Clock, ChevronDown,
  FileText, Check, X, MessageSquare, History,
} from "lucide-react";

interface DocumentEditorProps {
  reportId: string;
  title: string;
  content: string;
  status: string;
  type: string;
  projectName?: string;
  versions?: { id: string; version: number; editedBy: string; createdAt: string; comment: string }[];
  onSave: (content: string, comment?: string) => Promise<void>;
  onApprove?: () => Promise<void>;
  onReject?: (reason: string) => Promise<void>;
  onExportPDF?: () => void;
  onExportDOCX?: () => void;
  onClose: () => void;
}

// ── Toolbar Button ──
function ToolbarBtn({ onClick, active, disabled, children, title }: {
  onClick: () => void; active?: boolean; disabled?: boolean; children: React.ReactNode; title?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`p-1.5 rounded-md transition-colors ${
        active ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"
      } ${disabled ? "opacity-30 cursor-not-allowed" : "cursor-pointer"}`}
    >
      {children}
    </button>
  );
}

function ToolbarDivider() {
  return <div className="w-px h-5 bg-border mx-1" />;
}

export function DocumentEditor({
  reportId, title, content, status, type, projectName,
  versions = [], onSave, onApprove, onReject, onExportPDF, onExportDOCX, onClose,
}: DocumentEditorProps) {
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [saving, setSaving] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const [saveComment, setSaveComment] = useState("");
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [showRejectModal, setShowRejectModal] = useState(false);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Highlight.configure({ multicolor: true }),
      Typography,
      Underline,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      Placeholder.configure({ placeholder: "Start writing or paste content..." }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Link.configure({ openOnClick: false }),
      Image,
    ],
    content: content || "<p>No content generated yet. Generate a report to populate this document.</p>",
    editable: mode === "edit",
    editorProps: {
      attributes: {
        class: "prose prose-sm dark:prose-invert max-w-none focus:outline-none min-h-[400px] px-8 py-6",
      },
    },
  });

  // Update editable when mode changes
  if (editor && editor.isEditable !== (mode === "edit")) {
    editor.setEditable(mode === "edit");
  }

  const handleSave = useCallback(async () => {
    if (!editor) return;
    setSaving(true);
    try {
      await onSave(editor.getHTML(), saveComment || undefined);
      setMode("view");
      setShowSaveModal(false);
      setSaveComment("");
    } catch (e) {
      alert("Failed to save");
    }
    setSaving(false);
  }, [editor, onSave, saveComment]);

  const handleReject = useCallback(async () => {
    if (!onReject) return;
    await onReject(rejectReason);
    setShowRejectModal(false);
    setRejectReason("");
  }, [onReject, rejectReason]);

  const wordCount = editor ? editor.storage.characterCount?.words?.() || editor.getText().split(/\s+/).filter(Boolean).length : 0;
  const charCount = editor ? editor.getText().length : 0;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      {/* ── Top Bar ── */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-card">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onClose}><X className="w-4 h-4" /></Button>
          <div>
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-primary" />
              <h1 className="text-sm font-bold">{title}</h1>
              <Badge variant={status === "PUBLISHED" ? "default" : status === "DRAFT" ? "secondary" : "outline"} className="text-[9px]">{status}</Badge>
              <Badge variant="outline" className="text-[9px]">{type}</Badge>
            </div>
            {projectName && <p className="text-[10px] text-muted-foreground ml-6">{projectName}</p>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Mode toggle */}
          <div className="flex rounded-lg border border-border overflow-hidden">
            <button className={`px-3 py-1 text-xs font-semibold flex items-center gap-1 ${mode === "view" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
              onClick={() => setMode("view")}><Eye className="w-3 h-3" /> View</button>
            <button className={`px-3 py-1 text-xs font-semibold flex items-center gap-1 ${mode === "edit" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
              onClick={() => setMode("edit")}><Edit3 className="w-3 h-3" /> Edit</button>
          </div>

          {/* Version history */}
          <Button variant="ghost" size="sm" onClick={() => setShowVersions(!showVersions)}>
            <History className="w-4 h-4 mr-1" /> {versions.length} versions
          </Button>

          {/* Export */}
          {onExportPDF && <Button variant="outline" size="sm" onClick={onExportPDF}><Download className="w-3.5 h-3.5 mr-1" /> PDF</Button>}
          {onExportDOCX && <Button variant="outline" size="sm" onClick={onExportDOCX}><Download className="w-3.5 h-3.5 mr-1" /> DOCX</Button>}

          {/* Save */}
          {mode === "edit" && (
            <Button size="sm" onClick={() => setShowSaveModal(true)} disabled={saving}>
              <Save className="w-3.5 h-3.5 mr-1" /> {saving ? "Saving..." : "Save"}
            </Button>
          )}

          {/* Approve/Reject */}
          {status === "DRAFT" && onApprove && (
            <>
              <Button size="sm" onClick={onApprove}><Check className="w-3.5 h-3.5 mr-1" /> Approve</Button>
              <Button variant="destructive" size="sm" onClick={() => setShowRejectModal(true)}><X className="w-3.5 h-3.5 mr-1" /> Reject</Button>
            </>
          )}
        </div>
      </div>

      {/* ── Toolbar (edit mode) ── */}
      {mode === "edit" && editor && (
        <div className="flex items-center gap-0.5 px-4 py-1.5 border-b border-border bg-muted/30 flex-wrap">
          <ToolbarBtn onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive("bold")} title="Bold"><Bold className="w-4 h-4" /></ToolbarBtn>
          <ToolbarBtn onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive("italic")} title="Italic"><Italic className="w-4 h-4" /></ToolbarBtn>
          <ToolbarBtn onClick={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive("underline")} title="Underline"><UnderlineIcon className="w-4 h-4" /></ToolbarBtn>
          <ToolbarBtn onClick={() => editor.chain().focus().toggleStrike().run()} active={editor.isActive("strike")} title="Strikethrough"><Strikethrough className="w-4 h-4" /></ToolbarBtn>
          <ToolbarBtn onClick={() => editor.chain().focus().toggleHighlight().run()} active={editor.isActive("highlight")} title="Highlight"><Highlighter className="w-4 h-4" /></ToolbarBtn>
          <ToolbarBtn onClick={() => editor.chain().focus().toggleCode().run()} active={editor.isActive("code")} title="Code"><Code className="w-4 h-4" /></ToolbarBtn>

          <ToolbarDivider />

          <ToolbarBtn onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} active={editor.isActive("heading", { level: 1 })} title="Heading 1"><Heading1 className="w-4 h-4" /></ToolbarBtn>
          <ToolbarBtn onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive("heading", { level: 2 })} title="Heading 2"><Heading2 className="w-4 h-4" /></ToolbarBtn>
          <ToolbarBtn onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} active={editor.isActive("heading", { level: 3 })} title="Heading 3"><Heading3 className="w-4 h-4" /></ToolbarBtn>

          <ToolbarDivider />

          <ToolbarBtn onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive("bulletList")} title="Bullet List"><List className="w-4 h-4" /></ToolbarBtn>
          <ToolbarBtn onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive("orderedList")} title="Numbered List"><ListOrdered className="w-4 h-4" /></ToolbarBtn>
          <ToolbarBtn onClick={() => editor.chain().focus().toggleTaskList().run()} active={editor.isActive("taskList")} title="Task List"><CheckSquare className="w-4 h-4" /></ToolbarBtn>

          <ToolbarDivider />

          <ToolbarBtn onClick={() => editor.chain().focus().setTextAlign("left").run()} active={editor.isActive({ textAlign: "left" })} title="Align Left"><AlignLeft className="w-4 h-4" /></ToolbarBtn>
          <ToolbarBtn onClick={() => editor.chain().focus().setTextAlign("center").run()} active={editor.isActive({ textAlign: "center" })} title="Align Center"><AlignCenter className="w-4 h-4" /></ToolbarBtn>
          <ToolbarBtn onClick={() => editor.chain().focus().setTextAlign("right").run()} active={editor.isActive({ textAlign: "right" })} title="Align Right"><AlignRight className="w-4 h-4" /></ToolbarBtn>
          <ToolbarBtn onClick={() => editor.chain().focus().setTextAlign("justify").run()} active={editor.isActive({ textAlign: "justify" })} title="Justify"><AlignJustify className="w-4 h-4" /></ToolbarBtn>

          <ToolbarDivider />

          <ToolbarBtn onClick={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive("blockquote")} title="Quote"><Quote className="w-4 h-4" /></ToolbarBtn>
          <ToolbarBtn onClick={() => editor.chain().focus().setHorizontalRule().run()} title="Divider"><Minus className="w-4 h-4" /></ToolbarBtn>
          <ToolbarBtn onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} title="Insert Table"><TableIcon className="w-4 h-4" /></ToolbarBtn>

          <ToolbarDivider />

          <ToolbarBtn onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()} title="Undo"><Undo2 className="w-4 h-4" /></ToolbarBtn>
          <ToolbarBtn onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()} title="Redo"><Redo2 className="w-4 h-4" /></ToolbarBtn>

          <div className="ml-auto text-[10px] text-muted-foreground">
            {wordCount} words · {charCount} chars
          </div>
        </div>
      )}

      {/* ── Content Area ── */}
      <div className="flex-1 flex overflow-hidden">
        {/* Document */}
        <div className="flex-1 overflow-y-auto bg-background">
          <div className="max-w-[800px] mx-auto my-8 bg-card rounded-xl border border-border shadow-lg min-h-[600px]">
            {/* Document header */}
            <div className="px-8 pt-8 pb-4 border-b border-border/30">
              <div className="flex items-center gap-2 mb-2">
                <Badge variant="outline" className="text-[9px]">{type}</Badge>
                {projectName && <Badge variant="secondary" className="text-[9px]">{projectName}</Badge>}
              </div>
              <h1 className="text-xl font-bold">{title}</h1>
              <p className="text-xs text-muted-foreground mt-1">
                Generated {new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })} · {wordCount} words
              </p>
            </div>
            {/* Editor content */}
            <EditorContent editor={editor} />
          </div>
        </div>

        {/* Version History sidebar */}
        {showVersions && (
          <div className="w-[280px] flex-shrink-0 border-l border-border overflow-y-auto bg-card p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold">Version History</h3>
              <Button variant="ghost" size="sm" onClick={() => setShowVersions(false)}><X className="w-3.5 h-3.5" /></Button>
            </div>
            {versions.length === 0 ? (
              <div className="text-center py-8">
                <Clock className="w-6 h-6 text-muted-foreground mx-auto mb-2" />
                <p className="text-xs text-muted-foreground">No previous versions. Save an edit to create a version.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {/* Current version */}
                <div className="p-3 rounded-lg bg-primary/5 border border-primary/20">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-bold text-primary">Current</span>
                    <Badge variant="default" className="text-[8px]">Live</Badge>
                  </div>
                  <p className="text-[10px] text-muted-foreground">Latest saved version</p>
                </div>
                {/* Past versions */}
                {versions.map(v => (
                  <div key={v.id} className="p-3 rounded-lg bg-muted/30 border border-border/30 cursor-pointer hover:bg-muted/50 transition-colors">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-semibold">Version {v.version}</span>
                      <span className="text-[10px] text-muted-foreground">{new Date(v.createdAt).toLocaleDateString()}</span>
                    </div>
                    {v.editedBy && <p className="text-[10px] text-muted-foreground">By {v.editedBy}</p>}
                    {v.comment && <p className="text-[10px] text-muted-foreground italic mt-1">"{v.comment}"</p>}
                    <Button variant="ghost" size="sm" className="mt-1 h-6 text-[10px] p-0">Restore this version</Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Status Bar ── */}
      <div className="flex items-center justify-between px-4 py-1.5 border-t border-border bg-muted/30 text-[10px] text-muted-foreground">
        <div className="flex items-center gap-4">
          <span>Status: <strong className="text-foreground">{status}</strong></span>
          <span>Mode: <strong className="text-foreground">{mode === "edit" ? "Editing" : "Viewing"}</strong></span>
          <span>{wordCount} words · {charCount} characters</span>
        </div>
        <div className="flex items-center gap-2">
          <span>Report ID: {reportId.slice(-8)}</span>
        </div>
      </div>

      {/* ── Save Modal ── */}
      {showSaveModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60" onClick={() => setShowSaveModal(false)}>
          <Card className="w-[400px]" onClick={e => e.stopPropagation()}>
            <CardContent className="pt-5 space-y-4">
              <h3 className="text-base font-bold">Save Document</h3>
              <p className="text-sm text-muted-foreground">A new version will be created. Add an optional comment describing your changes.</p>
              <textarea
                className="w-full px-3 py-2 rounded-lg text-sm bg-background border border-input resize-none"
                rows={3} placeholder="What did you change? (optional)"
                value={saveComment} onChange={e => setSaveComment(e.target.value)} />
              <div className="flex gap-2 justify-end">
                <Button variant="outline" size="sm" onClick={() => setShowSaveModal(false)}>Cancel</Button>
                <Button size="sm" onClick={handleSave} disabled={saving}>
                  <Save className="w-3.5 h-3.5 mr-1" /> {saving ? "Saving..." : "Save & Create Version"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Reject Modal ── */}
      {showRejectModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60" onClick={() => setShowRejectModal(false)}>
          <Card className="w-[400px]" onClick={e => e.stopPropagation()}>
            <CardContent className="pt-5 space-y-4">
              <h3 className="text-base font-bold text-destructive">Reject Document</h3>
              <p className="text-sm text-muted-foreground">Provide a reason for rejection. The agent will be notified and may revise.</p>
              <textarea
                className="w-full px-3 py-2 rounded-lg text-sm bg-background border border-input resize-none"
                rows={3} placeholder="Reason for rejection..."
                value={rejectReason} onChange={e => setRejectReason(e.target.value)} />
              <div className="flex gap-2 justify-end">
                <Button variant="outline" size="sm" onClick={() => setShowRejectModal(false)}>Cancel</Button>
                <Button variant="destructive" size="sm" onClick={handleReject} disabled={!rejectReason.trim()}>
                  <X className="w-3.5 h-3.5 mr-1" /> Reject with Feedback
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
