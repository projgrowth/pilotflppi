import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileText, Upload, Download, Trash2, File, Image, FileSpreadsheet } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

interface StorageFile {
  name: string;
  id: string;
  created_at: string;
  metadata: { size: number; mimetype: string } | null;
}

function useDocuments() {
  return useQuery({
    queryKey: ["documents"],
    queryFn: async () => {
      const { data, error } = await supabase.storage.from("documents").list("", {
        limit: 100,
        sortBy: { column: "created_at", order: "desc" },
      });
      if (error) throw error;
      return (data || []).filter((f) => f.name !== ".emptyFolderPlaceholder") as StorageFile[];
    },
  });
}

function getFileIcon(name: string) {
  const ext = name.split(".").pop()?.toLowerCase();
  if (["jpg", "jpeg", "png", "gif", "webp", "svg"].includes(ext || "")) return Image;
  if (["xls", "xlsx", "csv"].includes(ext || "")) return FileSpreadsheet;
  if (["pdf"].includes(ext || "")) return FileText;
  return File;
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function Documents() {
  const { data: files, isLoading } = useDocuments();
  const queryClient = useQueryClient();
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);

  const uploadFiles = useCallback(async (fileList: FileList | File[]) => {
    setUploading(true);
    const toUpload = Array.from(fileList);
    let successCount = 0;

    for (const file of toUpload) {
      const fileName = `${Date.now()}_${file.name}`;
      const { error } = await supabase.storage.from("documents").upload(fileName, file);
      if (error) {
        toast.error(`Failed to upload ${file.name}: ${error.message}`);
      } else {
        successCount++;
      }
    }

    if (successCount > 0) {
      toast.success(`${successCount} file${successCount > 1 ? "s" : ""} uploaded`);
      queryClient.invalidateQueries({ queryKey: ["documents"] });
    }
    setUploading(false);
  }, [queryClient]);

  const downloadFile = async (name: string) => {
    const { data, error } = await supabase.storage.from("documents").download(name);
    if (error) { toast.error(error.message); return; }
    const url = URL.createObjectURL(data);
    const a = document.createElement("a");
    a.href = url;
    a.download = name.replace(/^\d+_/, "");
    a.click();
    URL.revokeObjectURL(url);
  };

  const deleteFile = async (name: string) => {
    const { error } = await supabase.storage.from("documents").remove([name]);
    if (error) { toast.error(error.message); return; }
    toast.success("File deleted");
    queryClient.invalidateQueries({ queryKey: ["documents"] });
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files.length > 0) uploadFiles(e.dataTransfer.files);
  };

  return (
    <div className="p-6 md:p-8 max-w-7xl">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-medium">Documents</h1>
        <label>
          <input type="file" multiple className="hidden" onChange={(e) => e.target.files && uploadFiles(e.target.files)} />
          <Button asChild className="bg-accent text-accent-foreground hover:bg-accent/90 cursor-pointer">
            <span><Upload className="h-4 w-4 mr-2" /> Upload Files</span>
          </Button>
        </label>
      </div>

      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        className={cn(
          "mb-6 rounded-lg border-2 border-dashed p-8 text-center transition-colors",
          isDragging ? "border-accent bg-accent/5" : "border-border",
          uploading && "opacity-50 pointer-events-none"
        )}
      >
        <Upload className="h-8 w-8 mx-auto text-muted-foreground/40 mb-2" />
        <p className="text-sm text-muted-foreground">
          {uploading ? "Uploading..." : "Drag & drop files here, or click Upload"}
        </p>
      </div>

      {/* File list */}
      <Card className="shadow-subtle border">
        {isLoading ? (
          <div className="divide-y">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-5 py-4">
                <div className="h-8 w-8 rounded bg-muted animate-pulse" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-48 rounded bg-muted animate-pulse" />
                  <div className="h-3 w-24 rounded bg-muted animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        ) : (files || []).length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <FileText className="h-10 w-10 text-muted-foreground/40 mb-3" />
            <h3 className="text-sm font-medium">No documents yet</h3>
            <p className="text-xs text-muted-foreground mt-1">Upload plans, certificates, and reports</p>
          </div>
        ) : (
          <div className="divide-y">
            {(files || []).map((file) => {
              const Icon = getFileIcon(file.name);
              const displayName = file.name.replace(/^\d+_/, "");
              return (
                <div key={file.id} className="flex items-center gap-4 px-5 py-3 hover:bg-muted/30 transition-colors">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted">
                    <Icon className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{displayName}</p>
                    <p className="text-xs text-muted-foreground">
                      {file.metadata?.size ? formatSize(file.metadata.size) : "—"} · {format(new Date(file.created_at), "MMM d, yyyy")}
                    </p>
                  </div>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => downloadFile(file.name)}>
                    <Download className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => deleteFile(file.name)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
