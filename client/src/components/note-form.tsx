import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

const noteSchema = z.object({
  noteType: z.enum(["note", "call", "email", "meeting", "task"]),
  subject: z.string().optional(),
  content: z.string().min(1, "Content is required"),
  isPinned: z.boolean().default(false),
  dueDate: z.string().optional(),
  isCompleted: z.boolean().default(false),
});

type NoteFormData = z.infer<typeof noteSchema>;

interface NoteFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customerId: string;
}

export default function NoteForm({ open, onOpenChange, customerId }: NoteFormProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
    setValue,
    watch,
    reset,
  } = useForm<NoteFormData>({
    resolver: zodResolver(noteSchema),
    defaultValues: {
      noteType: "note",
      subject: "",
      content: "",
      isPinned: false,
      dueDate: "",
      isCompleted: false,
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: NoteFormData) => {
      const response = await fetch(`/api/customers/${customerId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to create note");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/customers/${customerId}`] });
      toast({ title: "Success", description: "Note created successfully" });
      reset();
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const onSubmit = async (data: NoteFormData) => {
    setIsSubmitting(true);
    try {
      await createMutation.mutateAsync(data);
    } finally {
      setIsSubmitting(false);
    }
  };

  const noteType = watch("noteType");
  const isPinned = watch("isPinned");
  const isCompleted = watch("isCompleted");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Activity</DialogTitle>
          <DialogDescription>
            Add a note, call log, email, meeting, or task for this customer
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          {/* Activity Type */}
          <div className="space-y-2">
            <Label htmlFor="noteType">Activity Type *</Label>
            <Select
              value={noteType}
              onValueChange={(value) => setValue("noteType", value as any)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="note">Note</SelectItem>
                <SelectItem value="call">Phone Call</SelectItem>
                <SelectItem value="email">Email</SelectItem>
                <SelectItem value="meeting">Meeting</SelectItem>
                <SelectItem value="task">Task</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Subject */}
          <div className="space-y-2">
            <Label htmlFor="subject">Subject</Label>
            <Input
              id="subject"
              {...register("subject")}
              placeholder="Brief summary of the activity"
            />
          </div>

          {/* Content */}
          <div className="space-y-2">
            <Label htmlFor="content">Content *</Label>
            <Textarea
              id="content"
              {...register("content")}
              placeholder="Detailed description..."
              rows={6}
            />
            {errors.content && (
              <p className="text-sm text-destructive mt-1">{errors.content.message}</p>
            )}
          </div>

          {/* Task-specific fields */}
          {noteType === "task" && (
            <div className="space-y-4 p-4 border rounded-lg bg-muted/50">
              <h4 className="font-medium">Task Details</h4>

              <div className="space-y-2">
                <Label htmlFor="dueDate">Due Date</Label>
                <Input
                  id="dueDate"
                  type="date"
                  {...register("dueDate")}
                />
              </div>

              <div className="flex items-center space-x-2">
                <Checkbox
                  id="isCompleted"
                  checked={isCompleted}
                  onCheckedChange={(checked) => setValue("isCompleted", checked as boolean)}
                />
                <Label htmlFor="isCompleted" className="font-normal cursor-pointer">
                  Mark as completed
                </Label>
              </div>
            </div>
          )}

          {/* Pin Important */}
          <div className="flex items-center space-x-2">
            <Checkbox
              id="isPinned"
              checked={isPinned}
              onCheckedChange={(checked) => setValue("isPinned", checked as boolean)}
            />
            <Label htmlFor="isPinned" className="font-normal cursor-pointer">
              Pin this activity (show at top of activity list)
            </Label>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Saving..." : "Create Activity"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

