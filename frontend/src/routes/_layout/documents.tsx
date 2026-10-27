/* AIGEN ADD START */

import { createFileRoute, useBlocker } from "@tanstack/react-router"

import { Loader2, PencilSparkles, Upload, X } from "lucide-react"
import * as React from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  FileUpload,
  FileUploadDropzone,
  FileUploadItem,
  FileUploadItemDelete,
  FileUploadItemMetadata,
  FileUploadItemPreview,
  FileUploadList,
  FileUploadTrigger,
} from "@/components/ui/file-upload"

export const Route = createFileRoute("/_layout/documents")({
  component: Documents,
  head: () => ({
    meta: [
      {
        title: "Documents - SnapFill",
      },
    ],
  }),
})

type DocumentStatus = "processing" | "success" | "error"

interface DropzoneProps {
  files: File[]
  setFiles: (files: File[]) => void
  statuses: Map<File, DocumentStatus>
}

export function Dropzone({ files, setFiles, statuses }: DropzoneProps) {
  const onFileReject = React.useCallback((file: File, message: string) => {
    toast(message, {
      description: `"${file.name.length > 20 ? `${file.name.slice(0, 20)}...` : file.name}" has been rejected`,
    })
  }, [])

  return (
    <FileUpload
      accept=".pdf"
      maxFiles={2}
      maxSize={5 * 1024 * 1024}
      className="w-full max-w-md"
      value={files}
      onValueChange={setFiles}
      onFileReject={onFileReject}
      multiple
      disabled={statuses.size > 0}
    >
      <FileUploadDropzone>
        <div className="flex flex-col items-center gap-1 text-center">
          <div className="flex items-center justify-center rounded-full border p-2.5">
            <Upload className="size-6 text-muted-foreground" />
          </div>
          <p className="text-sm font-medium">Drag & drop files here</p>
          <p className="text-xs text-muted-foreground">Or click to browse</p>
          <p className="text-xs text-muted-foreground">
            PDF only · Max 2 files · Up to 5MB each
          </p>
        </div>
        <FileUploadTrigger asChild>
          <Button variant="outline" size="sm" className="mt-2 w-fit">
            Browse files
          </Button>
        </FileUploadTrigger>
      </FileUploadDropzone>
      <FileUploadList>
        {files.map((file, index) => (
          <FileUploadItem key={index} value={file}>
            <FileUploadItemPreview />
            <FileUploadItemMetadata />
            {statuses.size > 0 ? (
              <div className="size-7" />
            ) : (
              <FileUploadItemDelete asChild>
                <Button variant="ghost" size="icon" className="size-7">
                  <X />
                </Button>
              </FileUploadItemDelete>
            )}
          </FileUploadItem>
        ))}
      </FileUploadList>
    </FileUpload>
  )
}

function Documents() {
  const [files, setFiles] = React.useState<File[]>([])
  const [statuses, setStatuses] = React.useState<Map<File, DocumentStatus>>(
    () => new Map(),
  )

  const handleFillAll = () => {
    // TODO: review
    setStatuses((prev) => {
      const next = new Map(prev)
      for (const file of files) {
        next.set(file, "processing")
      }
      return next
    })
  }

  useBlocker({
    shouldBlockFn: () => {
      if (statuses.size > 0)
        return !window.confirm(
          // TODO use native?
          "Documents are currently being processed. If you leave now, progress will be lost. Are you sure you want to leave?",
        )
      return false
    },
  })

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Documents</h1>
          <p className="text-muted-foreground">
            Upload your documents and automatically fill them
          </p>
        </div>
        <Button // TODO review
          className="my-4"
          variant={statuses.size > 0 ? "secondary" : "default"}
          disabled={files.length === 0 || statuses.size > 0}
          onClick={handleFillAll}
        >
          {statuses.size > 0 ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Processing...
            </>
          ) : (
            <>
              <PencilSparkles className="mr-2 h-4 w-4" />
              Fill All ({files.length})
            </>
          )}
        </Button>
      </div>
      <Dropzone files={files} setFiles={setFiles} statuses={statuses} />
    </div>
  )
}

/* AIGEN ADD END */
