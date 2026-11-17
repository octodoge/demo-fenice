/* AIGEN ADD START */

import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { diffLines } from "diff"
import { Check, Pencil, Save, Sparkles, Upload, X } from "lucide-react"
import { Suspense, useCallback, useMemo, useRef, useState } from "react"
import { toast } from "sonner"

import { type ProfileBase, type ProfileCreate, ProfileService } from "@/client"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
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

type Segment = {
  id: number
  text: string
  type: "normal" | "added" | "removed"
}

function mergeAdjacentNormals(segments: Segment[]): Segment[] {
  const merged: Segment[] = []
  for (const seg of segments) {
    const prev = merged[merged.length - 1]
    if (prev && prev.type === "normal" && seg.type === "normal") {
      prev.text = `${prev.text}\n${seg.text}`
    } else {
      merged.push({ ...seg })
    }
  }
  return merged.length > 0 ? merged : [{ id: 0, text: "", type: "normal" }]
}

function buildSegmentsFromDiff(
  oldTemplate: string,
  newTemplate: string,
): Segment[] {
  const changes = diffLines(oldTemplate, newTemplate)
  const rawSegments: Segment[] = []
  let nextId = 1

  for (const part of changes) {
    if (!part.value) continue
    const text = part.value.endsWith("\n")
      ? part.value.slice(0, -1)
      : part.value

    if (!part.added && !part.removed) {
      rawSegments.push({ id: nextId++, text, type: "normal" })
      continue
    }

    const diffType = part.added ? "added" : "removed"
    let cursor = 0
    for (const match of text.matchAll(/\n(\n+)/g)) {
      const before = text.slice(cursor, match.index)
      if (before.trim().length > 0) {
        rawSegments.push({ id: nextId++, text: before, type: diffType })
      }
      rawSegments.push({
        id: nextId++,
        text: match[1].slice(1),
        type: "normal",
      })
      cursor = match.index + match[0].length
    }

    const tail = text.slice(cursor)
    if (tail.trim().length > 0) {
      rawSegments.push({ id: nextId++, text: tail, type: diffType })
    } else if (cursor === 0) {
      rawSegments.push({ id: nextId++, text: tail, type: "normal" })
    }
  }

  return mergeAdjacentNormals(rawSegments)
}

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

function renderPlaceholders(
  text: string,
  hoveredIndex: number | null,
  onHoverChange: (index: number | null) => void,
  onFocusPlaceholder: (key: string) => void,
) {
  return text.split(PLACEHOLDER_TOKEN_REGEX).map((part, index) => {
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
              className="pointer-events-auto absolute top-1/2 left-full z-20 ml-0.5 flex size-4 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-primary text-primary-foreground shadow-xs transition-transform hover:scale-110"
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

function SegmentEditor({
  segment,
  isOnlyNormal,
  onChange,
  onKeep,
  onRemove,
  onFocusPlaceholder,
}: {
  segment: Segment
  isOnlyNormal: boolean
  onChange: (text: string) => void
  onKeep: () => void
  onRemove: () => void
  onFocusPlaceholder: (key: string) => void
}) {
  const [hoveredPlaceholderIndex, setHoveredPlaceholderIndex] = useState<
    number | null
  >(null)
  const highlightLayerRef = useRef<HTMLDivElement | null>(null)

  const handleMouseMove = (e: React.MouseEvent<HTMLTextAreaElement>) => {
    const layer = highlightLayerRef.current
    if (!layer) return
    const spans = layer.querySelectorAll<HTMLElement>(
      "[data-placeholder-index]",
    )
    for (const span of spans) {
      for (const rect of span.getClientRects()) {
        if (
          e.clientX >= rect.left &&
          e.clientX <= rect.right + 20 &&
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

  const isDiff = segment.type !== "normal"
  const isAdded = segment.type === "added"

  return (
    <div
      className={
        isDiff
          ? isAdded
            ? "group relative rounded-xs bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
            : "group relative rounded-xs bg-destructive/15 text-destructive"
          : "relative"
      }
    >
      {isDiff && (
        <span
          className={`pointer-events-auto absolute top-0.5 right-0.5 z-30 hidden items-center gap-0.5 group-hover:flex ${isAdded ? "" : "flex-row-reverse"}`}
        >
          <button
            type="button"
            title="Keep block"
            onMouseDown={(e) => {
              e.preventDefault()
              e.stopPropagation()
            }}
            onClick={(e) => {
              e.stopPropagation()
              onKeep()
            }}
            className="flex size-4 cursor-pointer items-center justify-center rounded-full bg-emerald-600 text-white shadow-xs transition-transform hover:scale-110"
          >
            <Check className="size-2.5" />
          </button>
          <button
            type="button"
            title="Remove block"
            onMouseDown={(e) => {
              e.preventDefault()
              e.stopPropagation()
            }}
            onClick={(e) => {
              e.stopPropagation()
              onRemove()
            }}
            className="flex size-4 cursor-pointer items-center justify-center rounded-full bg-destructive text-white shadow-xs transition-transform hover:scale-110"
          >
            <X className="size-2.5" />
          </button>
        </span>
      )}
      <div className="grid w-full">
        <div
          ref={highlightLayerRef}
          aria-hidden="true"
          className="pointer-events-none relative z-10 col-start-1 row-start-1 w-full font-mono text-sm leading-relaxed whitespace-pre-wrap break-words"
        >
          {renderPlaceholders(
            segment.text,
            hoveredPlaceholderIndex,
            setHoveredPlaceholderIndex,
            onFocusPlaceholder,
          )}
          {segment.text === "" || segment.text.endsWith("\n") ? " " : null}
        </div>
        <textarea
          rows={1}
          value={segment.text}
          onChange={(e) => onChange(e.target.value)}
          onMouseMove={handleMouseMove}
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
          placeholder={
            isOnlyNormal
              ? "Enter your profile template using {placeholder} for sensitive data..."
              : undefined
          }
          spellCheck={false}
          className={`col-start-1 row-start-1 h-full w-full resize-none overflow-hidden bg-transparent font-mono text-sm leading-relaxed whitespace-pre-wrap break-words text-transparent caret-foreground selection:bg-primary/25 selection:text-transparent placeholder:text-muted-foreground focus:outline-none ${isOnlyNormal ? "min-h-44" : ""}`}
        />
      </div>
    </div>
  )
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
  template,
  onSuccess,
}: {
  template: string
  onSuccess: (profile: ProfileBase, demo: boolean) => void
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [files, setFiles] = useState<File[]>([])
  const [demo, setDemo] = useState(false)
  const { showSuccessToast, showErrorToast } = useCustomToast()

  const onFileReject = useCallback((file: File, message: string) => {
    toast(message, {
      description: `"${file.name.length > 20 ? `${file.name.slice(0, 20)}...` : file.name}" has been rejected`,
    })
  }, [])

  const inferMutation = useMutation({
    mutationFn: ({ files, demo }: { files: File[]; demo: boolean }) =>
      ProfileService.inferProfileTemplate({
        body: { files, template },
        query: { demo },
      }),
    onSuccess: (res, variables) => {
      onSuccess(res.data, variables.demo)
      setFiles([])
      setDemo(false)
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
      setDemo(false)
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
        <div className="flex items-center gap-2">
          <Checkbox
            id="infer-demo"
            checked={demo}
            onCheckedChange={(checked) => setDemo(checked === true)}
            disabled={inferMutation.isPending}
          />
          <Label
            htmlFor="infer-demo"
            className="cursor-pointer text-sm font-normal"
          >
            Populate with sample data
          </Label>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={inferMutation.isPending}>
              Cancel
            </Button>
          </DialogClose>
          <LoadingButton
            loading={inferMutation.isPending}
            disabled={files.length === 0}
            onClick={() => inferMutation.mutate({ files, demo })}
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

  const [segments, setSegments] = useState<Segment[]>(() => [
    { id: 0, text: profile.template, type: "normal" },
  ])
  const [sensitiveValues, setSensitiveValues] = useState<
    Record<string, string>
  >(() => profile.sensitive_data ?? {})
  const tableScrollRef = useRef<HTMLDivElement | null>(null)
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({})

  const template = useMemo(
    () => segments.map((s) => s.text).join("\n"),
    [segments],
  )

  const hasUnresolvedDiffs = useMemo(
    () => segments.some((s) => s.type !== "normal"),
    [segments],
  )

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

  const handleKeepSegment = useCallback((id: number) => {
    setSegments((prev) =>
      mergeAdjacentNormals(
        prev.map((s) => (s.id === id ? { ...s, type: "normal" } : s)),
      ),
    )
  }, [])

  const handleRemoveSegment = useCallback((id: number) => {
    setSegments((prev) => {
      const idx = prev.findIndex((s) => s.id === id)
      if (idx === -1) return prev
      const next = [...prev]
      if (
        idx + 1 < next.length &&
        next[idx + 1].type === "normal" &&
        next[idx + 1].text === ""
      ) {
        next.splice(idx, 2)
      } else if (
        idx > 0 &&
        next[idx - 1].type === "normal" &&
        next[idx - 1].text === ""
      ) {
        next.splice(idx - 1, 2)
      } else {
        next.splice(idx, 1)
      }
      return mergeAdjacentNormals(next)
    })
  }, [])

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
      setSegments([{ id: 0, text: res.data.template, type: "normal" }])
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
            template={template}
            onSuccess={(inferred, demo) => {
              setSegments(buildSegmentsFromDiff(template, inferred.template))
              setSensitiveValues((prev) =>
                demo
                  ? { ...prev, ...inferred.sensitive_data }
                  : { ...inferred.sensitive_data, ...prev },
              )
            }}
          />
          <LoadingButton
            loading={mutation.isPending}
            disabled={!isDirty || hasUnresolvedDiffs}
            onClick={handleSave}
          >
            <Save className="mr-2" />
            Save
          </LoadingButton>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label>Profile Template</Label>
          <div className="min-h-48 max-h-[calc(100vh-16rem)] w-full overflow-y-auto rounded-md border border-input bg-transparent py-2 pr-5 pl-3 shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 dark:bg-input/30">
            {segments.map((segment) => (
              <SegmentEditor
                key={segment.id}
                segment={segment}
                isOnlyNormal={segments.length === 1}
                onChange={(nextText) =>
                  setSegments((prev) =>
                    prev.map((s) =>
                      s.id === segment.id ? { ...s, text: nextText } : s,
                    ),
                  )
                }
                onKeep={() => handleKeepSegment(segment.id)}
                onRemove={() => handleRemoveSegment(segment.id)}
                onFocusPlaceholder={handleFocusPlaceholder}
              />
            ))}
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
