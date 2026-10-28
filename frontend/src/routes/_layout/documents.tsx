/* AIGEN REFS
// Drag and drop component: https://diceui.com/docs/components/radix/file-upload
/* AIGEN ADD START */

import { createFileRoute, useBlocker } from "@tanstack/react-router"

import { Download, LoaderCircle, PencilSparkles, Upload, X } from "lucide-react"
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

  const isProcessing = [...statuses.values()].includes("processing")
  const isFinished = statuses.size > 0 && !isProcessing
  const successCount = [...statuses.values()].filter(
    (s) => s === "success",
  ).length

  const handleFillAll = () => {
    setStatuses(new Map(files.map((file) => [file, "processing"])))
    // TODO: implement fill logic
  }

  const handleDownloadAll = () => {
    // TODO: implement download logic
  }

  useBlocker({
    shouldBlockFn: () => {
      if (statuses.size > 0)
        return !window.confirm(
          "Make sure you downloaded your filled documents. Leaving now will reset all progress. Are you sure you want to leave?",
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
        {isProcessing ? (
          <Button className="my-4" disabled>
            <LoaderCircle className="mr-2 animate-spin" />
            Processing...
          </Button>
        ) : isFinished ? (
          <Button
            className="my-4"
            disabled={successCount === 0}
            onClick={handleDownloadAll}
          >
            <Download className="mr-2" />
            Download All ({successCount})
          </Button>
        ) : (
          <Button
            className="my-4"
            disabled={files.length === 0}
            onClick={handleFillAll}
          >
            <PencilSparkles className="mr-2" />
            Fill All ({files.length})
          </Button>
        )}
      </div>
      <Dropzone files={files} setFiles={setFiles} statuses={statuses} />
    </div>
  )
}

/* AIGEN ADD END */
