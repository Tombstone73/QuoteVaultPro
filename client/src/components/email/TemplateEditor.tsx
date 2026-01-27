import { useEffect } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import DOMPurify from "dompurify";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  List,
  ListOrdered,
  Undo,
  Redo,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface TemplateEditorProps {
  valueHtml: string;
  onChangeHtml: (html: string) => void;
  variables: Array<{ token: string; label: string }>;
}

/**
 * Sanitize HTML to prevent XSS
 * Allow only safe formatting tags, enforce safe link attributes
 */
function sanitizeHtml(html: string): string {
  const sanitized = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ["p", "br", "strong", "b", "em", "i", "u", "ul", "ol", "li", "a"],
    ALLOWED_ATTR: ["href", "rel", "target"],
    ALLOW_DATA_ATTR: false,
  });
  
  // Enforce rel="noopener noreferrer" on links with target="_blank"
  const parser = new DOMParser();
  const doc = parser.parseFromString(sanitized, 'text/html');
  const links = doc.querySelectorAll('a[target="_blank"]');
  links.forEach(link => {
    const rel = link.getAttribute('rel');
    if (!rel || !rel.includes('noopener')) {
      link.setAttribute('rel', 'noopener noreferrer');
    }
  });
  
  return doc.body.innerHTML;
}

export function TemplateEditor({
  valueHtml,
  onChangeHtml,
  variables,
}: TemplateEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // Disable unwanted features
        heading: false,
        code: false,
        codeBlock: false,
        blockquote: false,
        horizontalRule: false,
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          target: '_blank',
          rel: 'noopener noreferrer',
        },
      }),
    ],
    content: valueHtml,
    editorProps: {
      attributes: {
        class:
          "prose prose-sm dark:prose-invert max-w-none p-4 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 rounded-md text-foreground",
      },
    },
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      const sanitized = sanitizeHtml(html);
      onChangeHtml(sanitized);
    },
  });

  // Sync external changes to editor
  useEffect(() => {
    if (editor && valueHtml !== editor.getHTML()) {
      editor.commands.setContent(valueHtml);
    }
  }, [valueHtml, editor]);

  const insertVariable = (token: string) => {
    if (!editor) return;
    editor.chain().focus().insertContent(`{{${token}}}`).run();
  };

  if (!editor) {
    return <div className="min-h-[300px] p-4 border rounded-md bg-muted/30">Loading editor...</div>;
  }

  return (
    <div className="space-y-2">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-1 p-2 border rounded-md bg-muted/30">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => editor.chain().focus().toggleBold().run()}
          className={cn(editor.isActive("bold") && "bg-accent")}
          title="Bold"
        >
          <Bold className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => editor.chain().focus().toggleItalic().run()}
          className={cn(editor.isActive("italic") && "bg-accent")}
          title="Italic"
        >
          <Italic className="h-4 w-4" />
        </Button>
        
        <div className="w-px h-6 bg-border" />
        
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          className={cn(editor.isActive("bulletList") && "bg-accent")}
          title="Bullet List"
        >
          <List className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          className={cn(editor.isActive("orderedList") && "bg-accent")}
          title="Numbered List"
        >
          <ListOrdered className="h-4 w-4" />
        </Button>
        
        <div className="w-px h-6 bg-border" />
        
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => editor.chain().focus().undo().run()}
          disabled={!editor.can().undo()}
          title="Undo"
        >
          <Undo className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => editor.chain().focus().redo().run()}
          disabled={!editor.can().redo()}
          title="Redo"
        >
          <Redo className="h-4 w-4" />
        </Button>
        
        <div className="w-px h-6 bg-border" />
        
        {/* Insert Variable Dropdown */}
        <Select onValueChange={insertVariable}>
          <SelectTrigger className="w-[200px] h-8">
            <SelectValue placeholder="Insert Variable" />
          </SelectTrigger>
          <SelectContent>
            {variables.map(({ token, label }) => (
              <SelectItem key={token} value={token}>
                <div className="flex flex-col">
                  <code className="text-xs font-mono">{`{{${token}}}`}</code>
                  <span className="text-xs text-muted-foreground">{label}</span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Editor Content */}
      <div className="border rounded-md bg-background">
        <div className="prose prose-sm max-w-none min-h-[220px] dark:prose-invert text-foreground">
          <EditorContent editor={editor} />
        </div>
      </div>
    </div>
  );
}
