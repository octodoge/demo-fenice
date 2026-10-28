/* AIGEN REFS
// Drag and drop component: https://diceui.com/docs/components/radix/file-upload
/* AIGEN ADD START */

import { useMutation } from "@tanstack/react-query"
import { createFileRoute, useBlocker } from "@tanstack/react-router"
import { downloadZip } from "client-zip"
import {
  CircleCheck,
  CircleX,
  Download,
  LoaderCircle,
  PencilSparkles,
  Upload,
  X,
} from "lucide-react"
import * as React from "react"
import { toast } from "sonner"

import { DocumentsService } from "@/client"
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
import useCustomToast from "@/hooks/useCustomToast"
import { handleError } from "@/utils"

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
      className="w-full max-w-md mx-auto"
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
        {files.map((file, index) => {
          const status = statuses.get(file)

          return (
            <FileUploadItem key={index} value={file}>
              <FileUploadItemPreview />
              <FileUploadItemMetadata />
              {status === "processing" ? (
                <div className="flex size-7 items-center justify-center">
                  <LoaderCircle className="animate-spin text-muted-foreground" />
                </div>
              ) : status === "success" ? (
                <div className="flex size-7 items-center justify-center">
                  <CircleCheck className="text-emerald-500" />
                </div>
              ) : status === "error" ? (
                <div className="flex size-7 items-center justify-center">
                  <CircleX className="text-destructive" />
                </div>
              ) : (
                <FileUploadItemDelete asChild>
                  <Button variant="ghost" size="icon" className="size-7">
                    <X />
                  </Button>
                </FileUploadItemDelete>
              )}
            </FileUploadItem>
          )
        })}
      </FileUploadList>
    </FileUpload>
  )
}

function Documents() {
  const { showErrorToast } = useCustomToast()
  const [files, setFiles] = React.useState<File[]>([])
  const [statuses, setStatuses] = React.useState<Map<File, DocumentStatus>>(
    () => new Map(),
  )
  const [downloadBlobs, setDownloadBlobs] = React.useState<Map<File, Blob>>(
    () => new Map(),
  )

  const isProcessing = [...statuses.values()].includes("processing")
  const isFinished = statuses.size > 0 && !isProcessing
  const successCount = [...statuses.values()].filter(
    (s) => s === "success",
  ).length

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      try {
        return await DocumentsService.uploadDocument({ body: { file } })
      } catch (err: any) {
        if (err.response?.data instanceof Blob) {
          err.response.data = JSON.parse(await err.response.data.text())
        }
        throw err
      }
    },
    onSuccess: (res, file) => {
      setStatuses((prev) => new Map(prev).set(file, "success"))
      setDownloadBlobs((prev) => new Map(prev).set(file, res.data as Blob))
    },
    onError: (error, file) => {
      setStatuses((prev) => new Map(prev).set(file, "error"))
      handleError.call(showErrorToast, error)
    },
  })

  const handleFillAll = () => {
    setStatuses(new Map(files.map((file) => [file, "processing"])))
    setDownloadBlobs(new Map())
    for (const file of files) {
      uploadMutation.mutate(file)
    }
  }

  const triggerBlobDownload = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = filename
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const handleDownloadAll = async () => {
    if (downloadBlobs.size === 1) {
      const [file, blob] = downloadBlobs.entries().next().value!
      triggerBlobDownload(blob, file.name)
      return
    }

    if (downloadBlobs.size > 1) {
      const filesToZip = Array.from(downloadBlobs.entries()).map(
        ([file, blob]) => ({
          name: file.name,
          input: blob,
        }),
      )
      const zipBlob = await downloadZip(filesToZip).blob()
      triggerBlobDownload(zipBlob, "filled_documents.zip")
    }
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
