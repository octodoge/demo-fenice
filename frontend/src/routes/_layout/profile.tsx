/* AIGEN ADD START */

import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { Pencil, Save, Sparkles, Upload, X } from "lucide-react"
import { Suspense, useCallback, useMemo, useRef, useState } from "react"
import { toast } from "sonner"

import { type ProfileBase, type ProfileCreate, ProfileService } from "@/client"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { LoadingButton } from "@/components/ui/loading-button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import useCustomToast from "@/hooks/useCustomToast"
import { handleError } from "@/utils"

const PLACEHOLDER_TOKEN_REGEX = /(\{\{|\}\}|\{[a-zA-Z_][a-zA-Z0-9_]*\})/g

function getProfileQueryOptions() {
  return {
    queryFn: async () => (await ProfileService.readProfile()).data,
    queryKey: ["profile"],
  }
}

function extractPlaceholders(template: string): string[] {
  const keys = new Set<string>()
  for (const match of template.matchAll(PLACEHOLDER_TOKEN_REGEX)) {
    const token = match[0]
    if (token !== "{{" && token !== "}}") {
      keys.add(token.slice(1, -1))
    }
  }
  return Array.from(keys).sort()
}

function renderHighlightedTemplate(
  template: string,
  hoveredIndex: number | null,
  onHoverChange: (index: number | null) => void,
  onFocusPlaceholder: (key: string) => void,
) {
  return template.split(PLACEHOLDER_TOKEN_REGEX).map((part, index) => {
    if (
      part.startsWith("{") &&
      part.endsWith("}") &&
      part !== "{{" &&
      part !== "}}"
    ) {
      const key = part.slice(1, -1)
      return (
        <span
          key={index}
          data-placeholder-index={index}
          className="relative rounded-xs bg-primary/15 text-primary"
        >
          {hoveredIndex === index && (
            <button
              type="button"
              title={`Fill {${key}}`}
              onMouseLeave={() => onHoverChange(null)}
              onMouseDown={(e) => {
                e.preventDefault()
                e.stopPropagation()
              }}
              onClick={(e) => {
                e.stopPropagation()
                onFocusPlaceholder(key)
              }}
              className="pointer-events-auto absolute top-1/2 left-0 z-20 flex size-4 -translate-x-1/2 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-primary text-primary-foreground shadow-xs transition-transform hover:scale-110"
            >
              <Pencil className="size-2.5" />
            </button>
          )}
          {part}
        </span>
      )
    }
    return part
  })
}

export const Route = createFileRoute("/_layout/profile")({
  component: Profile,
  head: () => ({
    meta: [
      {
        title: "Profile - SnapFill",
      },
    ],
  }),
})

function InferTemplateDialog({
  onSuccess,
}: {
  onSuccess: (profile: ProfileBase) => void
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [files, setFiles] = useState<File[]>([])
  const { showSuccessToast, showErrorToast } = useCustomToast()

  const onFileReject = useCallback((file: File, message: string) => {
    toast(message, {
      description: `"${file.name.length > 20 ? `${file.name.slice(0, 20)}...` : file.name}" has been rejected`,
    })
  }, [])

  const inferMutation = useMutation({
    mutationFn: (files: File[]) =>
      ProfileService.inferProfileTemplate({ body: { files } }),
    onSuccess: (res) => {
      onSuccess(res.data)
      setFiles([])
      setIsOpen(false)
      showSuccessToast("Profile template generated")
    },
    onError: handleError.bind(showErrorToast),
  })

  const handleOpenChange = (open: boolean) => {
    if (inferMutation.isPending) {
      return
    }
    setIsOpen(open)
    if (!open) {
      setFiles([])
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Sparkles className="mr-2" />
          Generate from PDFs
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Generate from PDFs</DialogTitle>
          <DialogDescription>
            Upload example PDF forms to infer a profile template and sensitive
            data placeholders.
          </DialogDescription>
        </DialogHeader>
        <FileUpload
          accept=".pdf"
          maxFiles={5}
          maxSize={5 * 1024 * 1024}
          className="w-full min-w-0"
          value={files}
          onValueChange={setFiles}
          onFileReject={onFileReject}
          multiple
          disabled={inferMutation.isPending}
        >
          <FileUploadDropzone>
            <div className="flex flex-col items-center gap-1 text-center">
              <div className="flex items-center justify-center rounded-full border p-2.5">
                <Upload className="size-6 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium">Drag & drop files here</p>
              <p className="text-xs text-muted-foreground">
                Or click to browse
              </p>
              <p className="text-xs text-muted-foreground">
                PDF only · Max 5 files · Up to 5MB each
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
                <FileUploadItemDelete asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    disabled={inferMutation.isPending}
                  >
                    <X />
                  </Button>
                </FileUploadItemDelete>
              </FileUploadItem>
            ))}
          </FileUploadList>
        </FileUpload>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={inferMutation.isPending}>
              Cancel
            </Button>
          </DialogClose>
          <LoadingButton
            loading={inferMutation.isPending}
            disabled={files.length === 0}
            onClick={() => inferMutation.mutate(files)}
          >
            Generate
          </LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function PendingProfile() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Profile</h1>
          <p className="text-muted-foreground">
            Manage your profile template and sensitive data
          </p>
        </div>
        <div className="my-4 flex items-center gap-2">
          <Button variant="outline" disabled>
            <Sparkles className="mr-2" />
            Generate from PDFs
          </Button>
          <LoadingButton disabled>
            <Save className="mr-2" />
            Save
          </LoadingButton>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-start">
        <div className="flex flex-col gap-2">
          <Label>Profile Template</Label>
          <Skeleton className="min-h-48 w-full rounded-md" />
        </div>
        <div className="flex flex-col gap-2">
          <Label>Sensitive Data</Label>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-1/3">Placeholder</TableHead>
                <TableHead>Value</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {Array.from({ length: 3 }).map((_, index) => (
                <TableRow key={index}>
                  <TableCell>
                    <Skeleton className="h-4 w-32 font-mono" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-9 w-full" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  )
}

function ProfileContent() {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const { data: profile } = useSuspenseQuery(getProfileQueryOptions())

  const [template, setTemplate] = useState(profile.template)
  const [sensitiveValues, setSensitiveValues] = useState<
    Record<string, string>
  >(() => profile.sensitive_data ?? {})
  const [hoveredPlaceholderIndex, setHoveredPlaceholderIndex] = useState<
    number | null
  >(null)
  const highlightLayerRef = useRef<HTMLDivElement | null>(null)
  const tableScrollRef = useRef<HTMLDivElement | null>(null)
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({})

  const handleFocusPlaceholder = useCallback((key: string) => {
    const input = inputRefs.current[key]
    if (!input) {
      return
    }
    input.focus({ preventScroll: true })
    const container = tableScrollRef.current
    if (container) {
      const containerRect = container.getBoundingClientRect()
      const inputRect = input.getBoundingClientRect()
      const offset =
        inputRect.top -
        containerRect.top -
        containerRect.height / 2 +
        inputRect.height / 2
      container.scrollBy({ top: offset, behavior: "smooth" })
    }
  }, [])

  const handleTemplateMouseMove = (
    e: React.MouseEvent<HTMLTextAreaElement>,
  ) => {
    const layer = highlightLayerRef.current
    if (!layer) {
      return
    }
    const spans = layer.querySelectorAll<HTMLElement>(
      "[data-placeholder-index]",
    )
    for (const span of spans) {
      for (const rect of span.getClientRects()) {
        if (
          e.clientX >= rect.left - 8 &&
          e.clientX <= rect.right &&
          e.clientY >= rect.top - 2 &&
          e.clientY <= rect.bottom + 2
        ) {
          setHoveredPlaceholderIndex(Number(span.dataset.placeholderIndex))
          return
        }
      }
    }
    setHoveredPlaceholderIndex(null)
  }

  const placeholders = useMemo(() => extractPlaceholders(template), [template])

  const activeSensitiveData = useMemo(() => {
    const data: Record<string, string> = {}
    for (const key of placeholders) {
      data[key] = sensitiveValues[key] ?? ""
    }
    return data
  }, [placeholders, sensitiveValues])

  const isDirty = useMemo(() => {
    if (template !== profile.template) {
      return true
    }
    const savedData = profile.sensitive_data ?? {}
    const savedKeys = Object.keys(savedData).sort()
    if (placeholders.length !== savedKeys.length) {
      return true
    }
    return placeholders.some(
      (key, index) =>
        key !== savedKeys[index] || activeSensitiveData[key] !== savedData[key],
    )
  }, [template, profile, placeholders, activeSensitiveData])

  const mutation = useMutation({
    mutationFn: (data: ProfileCreate) =>
      ProfileService.replaceProfile({ body: data }),
    onSuccess: (res) => {
      queryClient.setQueryData(["profile"], res.data)
      setTemplate(res.data.template)
      setSensitiveValues(res.data.sensitive_data ?? {})
      showSuccessToast("Profile saved successfully")
    },
    onError: handleError.bind(showErrorToast),
  })

  const handleSave = () => {
    mutation.mutate({
      template,
      sensitive_data: activeSensitiveData,
    })
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Profile</h1>
          <p className="text-muted-foreground">
            Manage your profile template and sensitive data
          </p>
        </div>
        <div className="my-4 flex items-center gap-2">
          <InferTemplateDialog
            onSuccess={(inferred) => {
              setTemplate(inferred.template)
              setSensitiveValues((prev) => ({
                ...inferred.sensitive_data,
                ...prev,
              }))
            }}
          />
          <LoadingButton
            loading={mutation.isPending}
            disabled={!isDirty}
            onClick={handleSave}
          >
            <Save className="mr-2" />
            Save
          </LoadingButton>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="profile-template">Profile Template</Label>
          <div className="min-h-48 max-h-[calc(100vh-16rem)] w-full overflow-y-auto rounded-md border border-input bg-transparent shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 dark:bg-input/30">
            <div className="grid min-h-full w-full">
              <div
                ref={highlightLayerRef}
                aria-hidden="true"
                className="pointer-events-none relative z-10 col-start-1 row-start-1 w-full px-3 py-2 font-mono text-sm leading-relaxed whitespace-pre-wrap break-words"
              >
                {renderHighlightedTemplate(
                  template,
                  hoveredPlaceholderIndex,
                  setHoveredPlaceholderIndex,
                  handleFocusPlaceholder,
                )}
                {template.endsWith("\n") ? "\n " : null}
              </div>
              <textarea
                id="profile-template"
                value={template}
                onChange={(e) => setTemplate(e.target.value)}
                onMouseMove={handleTemplateMouseMove}
                onMouseLeave={(e) => {
                  if (
                    !(
                      e.relatedTarget instanceof HTMLElement &&
                      e.relatedTarget.closest("button")
                    )
                  ) {
                    setHoveredPlaceholderIndex(null)
                  }
                }}
                placeholder="Enter your profile template using {placeholder} for sensitive data..."
                spellCheck={false}
                className="col-start-1 row-start-1 h-full w-full resize-none overflow-hidden bg-transparent px-3 py-2 font-mono text-sm leading-relaxed whitespace-pre-wrap break-words text-transparent caret-foreground selection:bg-primary/25 selection:text-transparent placeholder:text-muted-foreground focus:outline-none"
              />
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Label>Sensitive Data</Label>
          <div className="relative flex-1">
            <div
              ref={tableScrollRef}
              className="max-h-full overflow-y-auto rounded-lg border lg:absolute lg:inset-x-0 lg:top-0 [&_[data-slot=table-container]]:border-0"
            >
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-1/3">Placeholder</TableHead>
                    <TableHead>Value</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {placeholders.length > 0 ? (
                    placeholders.map((key) => (
                      <TableRow key={key}>
                        <TableCell className="font-mono text-sm font-medium text-primary">
                          {key}
                        </TableCell>
                        <TableCell>
                          <Input
                            ref={(el) => {
                              inputRefs.current[key] = el
                            }}
                            value={activeSensitiveData[key] ?? ""}
                            onChange={(e) =>
                              setSensitiveValues((prev) => ({
                                ...prev,
                                [key]: e.target.value,
                              }))
                            }
                            placeholder={`Enter value for {${key}}`}
                          />
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow className="hover:bg-transparent">
                      <TableCell
                        colSpan={2}
                        className="h-32 text-center text-muted-foreground"
                      >
                        No placeholders in template. Add {"{placeholder}"} tags
                        in the template to define sensitive data.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function Profile() {
  return (
    <Suspense fallback={<PendingProfile />}>
      <ProfileContent />
    </Suspense>
  )
}

/* AIGEN ADD END */
