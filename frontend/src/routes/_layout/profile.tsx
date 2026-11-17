/* AIGEN ADD START */

import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { diffLines } from "diff"
import { Check, Pencil, Save, Sparkles, Upload, X } from "lucide-react"
import {
  Fragment,
  Suspense,
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react"
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

type DiffRange = {
  start: number
  end: number
  type: "added" | "removed"
}

function splitRangeByParagraphs(range: DiffRange, text: string): DiffRange[] {
  let { start, end } = range
  while (start < end && text[start] === "\n") start++
  while (end > start + 1 && text[end - 1] === "\n" && text[end - 2] === "\n") {
    end--
  }
  if (end <= start) return []

  const slice = text.slice(start, end)
  const parts: DiffRange[] = []
  let cursor = 0

  for (const match of slice.matchAll(/\n\n+/g)) {
    const before = slice.slice(cursor, match.index + 1)
    const after = slice.slice(match.index + match[0].length)
    if (before.trim().length > 0 && after.trim().length > 0) {
      parts.push({
        start: start + cursor,
        end: start + match.index + 1,
        type: range.type,
      })
      cursor = match.index + match[0].length
    }
  }

  if (cursor < slice.length && slice.slice(cursor).trim().length > 0) {
    parts.push({
      start: start + cursor,
      end,
      type: range.type,
    })
  }

  return parts
}

function buildTemplateDiff(
  oldTemplate: string,
  newTemplate: string,
): { template: string; ranges: DiffRange[] } {
  const changes = diffLines(oldTemplate, newTemplate)
  let merged = ""
  const rawRanges: DiffRange[] = []

  changes.forEach((part, index) => {
    if (!part.value) return
    const isLast = index === changes.length - 1
    const value =
      !isLast && !part.value.endsWith("\n") ? `${part.value}\n` : part.value
    const start = merged.length
    merged += value
    const end = merged.length
    if (part.added) {
      rawRanges.push({ start, end, type: "added" })
    } else if (part.removed) {
      rawRanges.push({ start, end, type: "removed" })
    }
  })

  const ranges = rawRanges.flatMap((r) => splitRangeByParagraphs(r, merged))
  return { template: merged, ranges }
}

function adjustRangesForEdit(
  ranges: DiffRange[],
  prev: string,
  next: string,
  selectionStart: number,
): DiffRange[] {
  const delta = next.length - prev.length
  const maxEditStart = Math.min(
    prev.length,
    next.length,
    Math.max(0, selectionStart - Math.max(0, delta)),
  )
  let editStart = 0
  while (editStart < maxEditStart && prev[editStart] === next[editStart]) {
    editStart++
  }
  let suffix = 0
  while (
    suffix < prev.length - editStart &&
    suffix < next.length - editStart &&
    prev[prev.length - 1 - suffix] === next[next.length - 1 - suffix]
  ) {
    suffix++
  }
  const editEnd = prev.length - suffix

  return ranges.flatMap((r) => {
    if (
      r.end < editStart ||
      (r.end === editStart && prev[r.end - 1] === "\n")
    ) {
      return [r]
    }
    if (r.start > editEnd) {
      return [{ ...r, start: r.start + delta, end: r.end + delta }]
    }
    if (r.start <= editStart && editEnd <= r.end) {
      return r.end + delta > r.start ? [{ ...r, end: r.end + delta }] : []
    }
    const start = r.start < editStart ? r.start : editEnd + delta
    const end = r.end > editEnd ? r.end + delta : editStart
    return end > start ? [{ ...r, start, end }] : []
  })
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

function renderHighlightedTemplate(
  template: string,
  diffRanges: DiffRange[],
  hoveredPlaceholderIndex: number | null,
  onPlaceholderHoverChange: (index: number | null) => void,
  onFocusPlaceholder: (key: string) => void,
  hoveredDiffIndex: number | null,
  onDiffHoverChange: (index: number | null) => void,
  onKeepDiff: (index: number) => void,
  onRemoveDiff: (index: number) => void,
) {
  let placeholderCounter = 0

  const renderPlaceholders = (segmentText: string) =>
    segmentText.split(PLACEHOLDER_TOKEN_REGEX).map((part, index) => {
      if (
        part.startsWith("{") &&
        part.endsWith("}") &&
        part !== "{{" &&
        part !== "}}"
      ) {
        const currentIndex = placeholderCounter++
        const key = part.slice(1, -1)
        return (
          <span
            key={index}
            data-placeholder-index={currentIndex}
            className="relative rounded-xs bg-primary/15 text-primary"
          >
            {hoveredPlaceholderIndex === currentIndex && (
              <button
                type="button"
                title={`Fill {${key}}`}
                onMouseLeave={() => onPlaceholderHoverChange(null)}
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

  if (diffRanges.length === 0) {
    return (
      <>
        {renderPlaceholders(template)}
        {template.endsWith("\n") ? "\n " : null}
      </>
    )
  }

  const nodes: React.ReactNode[] = []
  let cursor = 0
  let lastWasBlock = false

  diffRanges.forEach((range, diffIndex) => {
    const isLineStart = range.start === 0 || template[range.start - 1] === "\n"
    const isLineEnd =
      range.end === template.length || template[range.end - 1] === "\n"
    const isBlock = isLineStart && isLineEnd

    if (range.start > cursor) {
      const normalSlice = template.slice(cursor, range.start)
      const trimmedNormal =
        isBlock && normalSlice.endsWith("\n")
          ? normalSlice.slice(0, -1)
          : normalSlice
      nodes.push(
        <Fragment key={`normal-${cursor}`}>
          {renderPlaceholders(trimmedNormal)}
          {isBlock && (trimmedNormal === "" || trimmedNormal.endsWith("\n"))
            ? " "
            : null}
        </Fragment>,
      )
    }

    const rangeText = template.slice(range.start, range.end)
    const isAdded = range.type === "added"
    const actionsNode = hoveredDiffIndex === diffIndex && (
      <span
        data-diff-actions
        className={`pointer-events-auto absolute top-0.5 right-0.5 z-30 flex items-center gap-0.5 ${isAdded ? "" : "flex-row-reverse"}`}
      >
        <button
          type="button"
          title="Keep block"
          onMouseLeave={(e) => {
            if (
              !(
                e.relatedTarget instanceof HTMLElement &&
                e.relatedTarget.closest("[data-diff-actions]")
              )
            ) {
              onDiffHoverChange(null)
            }
          }}
          onMouseDown={(e) => {
            e.preventDefault()
            e.stopPropagation()
          }}
          onClick={(e) => {
            e.stopPropagation()
            onKeepDiff(diffIndex)
          }}
          className="flex size-4 cursor-pointer items-center justify-center rounded-full bg-emerald-600 text-white shadow-xs transition-transform hover:scale-110"
        >
          <Check className="size-2.5" />
        </button>
        <button
          type="button"
          title="Remove block"
          onMouseLeave={(e) => {
            if (
              !(
                e.relatedTarget instanceof HTMLElement &&
                e.relatedTarget.closest("[data-diff-actions]")
              )
            ) {
              onDiffHoverChange(null)
            }
          }}
          onMouseDown={(e) => {
            e.preventDefault()
            e.stopPropagation()
          }}
          onClick={(e) => {
            e.stopPropagation()
            onRemoveDiff(diffIndex)
          }}
          className="flex size-4 cursor-pointer items-center justify-center rounded-full bg-destructive text-white shadow-xs transition-transform hover:scale-110"
        >
          <X className="size-2.5" />
        </button>
      </span>
    )

    if (isBlock) {
      const inner = rangeText.endsWith("\n")
        ? rangeText.slice(0, -1)
        : rangeText
      nodes.push(
        <div
          key={`diff-${diffIndex}`}
          data-diff-index={diffIndex}
          className={
            isAdded
              ? "relative rounded-xs bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
              : "relative rounded-xs bg-destructive/15 text-destructive"
          }
        >
          {actionsNode}
          {renderPlaceholders(inner)}
          {inner === "" || inner.endsWith("\n") ? " " : null}
        </div>,
      )
    } else {
      const hasTrailingNewline =
        rangeText.length > 1 && rangeText.endsWith("\n")
      const visibleText = hasTrailingNewline
        ? rangeText.slice(0, -1)
        : rangeText
      nodes.push(
        <Fragment key={`diff-${diffIndex}`}>
          <span
            data-diff-index={diffIndex}
            className={
              isAdded
                ? "relative rounded-xs bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                : "relative rounded-xs bg-destructive/15 text-destructive"
            }
          >
            {actionsNode}
            {renderPlaceholders(visibleText)}
          </span>
          {hasTrailingNewline ? "\n" : null}
        </Fragment>,
      )
    }

    cursor = range.end
    lastWasBlock = isBlock
  })

  if (cursor < template.length) {
    nodes.push(
      <Fragment key={`normal-${cursor}`}>
        {renderPlaceholders(template.slice(cursor))}
      </Fragment>,
    )
    lastWasBlock = false
  }

  if (template.endsWith("\n")) {
    nodes.push(lastWasBlock ? " " : "\n ")
  }

  return nodes
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

  const [template, setTemplate] = useState(profile.template)
  const [diffRanges, setDiffRanges] = useState<DiffRange[]>([])
  const [sensitiveValues, setSensitiveValues] = useState<
    Record<string, string>
  >(() => profile.sensitive_data ?? {})
  const [hoveredPlaceholderIndex, setHoveredPlaceholderIndex] = useState<
    number | null
  >(null)
  const [hoveredDiffIndex, setHoveredDiffIndex] = useState<number | null>(null)
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

  const handleKeepDiff = useCallback((index: number) => {
    setDiffRanges((prev) => prev.filter((_, i) => i !== index))
    setHoveredDiffIndex(null)
  }, [])

  const handleRemoveDiff = useCallback(
    (index: number) => {
      const range = diffRanges[index]
      if (!range) {
        return
      }
      let removeStart = range.start
      let removeEnd = range.end
      const nextRange = diffRanges[index + 1]
      const prevRange = diffRanges[index - 1]
      if (
        template[removeEnd] === "\n" &&
        (!nextRange || nextRange.start > removeEnd)
      ) {
        removeEnd += 1
      } else if (
        removeStart >= 2 &&
        template[removeStart - 1] === "\n" &&
        template[removeStart - 2] === "\n" &&
        (!prevRange || prevRange.end <= removeStart - 1)
      ) {
        removeStart -= 1
      }
      const nextTemplate =
        template.slice(0, removeStart) + template.slice(removeEnd)
      const delta = removeEnd - removeStart
      setTemplate(nextTemplate)
      setDiffRanges((prev) =>
        prev
          .filter((_, i) => i !== index)
          .map((r) =>
            r.start >= removeEnd
              ? { ...r, start: r.start - delta, end: r.end - delta }
              : r,
          ),
      )
      setHoveredDiffIndex(null)
    },
    [diffRanges, template],
  )

  const handleTemplateMouseMove = (
    e: React.MouseEvent<HTMLTextAreaElement>,
  ) => {
    const layer = highlightLayerRef.current
    if (!layer) {
      return
    }
    let nextPlaceholderIndex: number | null = null
    const placeholderSpans = layer.querySelectorAll<HTMLElement>(
      "[data-placeholder-index]",
    )
    for (const span of placeholderSpans) {
      for (const rect of span.getClientRects()) {
        if (
          e.clientX >= rect.left &&
          e.clientX <= rect.right + 20 &&
          e.clientY >= rect.top - 2 &&
          e.clientY <= rect.bottom + 2
        ) {
          nextPlaceholderIndex = Number(span.dataset.placeholderIndex)
          break
        }
      }
      if (nextPlaceholderIndex !== null) {
        break
      }
    }
    setHoveredPlaceholderIndex(nextPlaceholderIndex)

    let nextDiffIndex: number | null = null
    const diffSpans = layer.querySelectorAll<HTMLElement>("[data-diff-index]")
    for (const span of diffSpans) {
      for (const rect of span.getClientRects()) {
        if (
          e.clientX >= rect.left - 12 &&
          e.clientX <= rect.right &&
          e.clientY >= rect.top - 2 &&
          e.clientY <= rect.bottom + 2
        ) {
          nextDiffIndex = Number(span.dataset.diffIndex)
          break
        }
      }
      if (nextDiffIndex !== null) {
        break
      }
    }
    if (nextDiffIndex === null) {
      for (const span of diffSpans) {
        const rect = span.getBoundingClientRect()
        if (
          rect.height > 0 &&
          e.clientX >= rect.left - 12 &&
          e.clientY >= rect.top - 2 &&
          e.clientY <= rect.bottom + 2
        ) {
          nextDiffIndex = Number(span.dataset.diffIndex)
          break
        }
      }
    }
    setHoveredDiffIndex(nextDiffIndex)
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
      setDiffRanges([])
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
              const diff = buildTemplateDiff(template, inferred.template)
              setTemplate(diff.template)
              setDiffRanges(diff.ranges)
              setHoveredPlaceholderIndex(null)
              setHoveredDiffIndex(null)
              setSensitiveValues((prev) =>
                demo
                  ? { ...prev, ...inferred.sensitive_data }
                  : { ...inferred.sensitive_data, ...prev },
              )
            }}
          />
          <LoadingButton
            loading={mutation.isPending}
            disabled={!isDirty || diffRanges.length > 0}
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
                className="pointer-events-none relative z-10 col-start-1 row-start-1 w-full py-2 pr-5 pl-3 font-mono text-sm leading-relaxed whitespace-pre-wrap break-words"
              >
                {renderHighlightedTemplate(
                  template,
                  diffRanges,
                  hoveredPlaceholderIndex,
                  setHoveredPlaceholderIndex,
                  handleFocusPlaceholder,
                  hoveredDiffIndex,
                  setHoveredDiffIndex,
                  handleKeepDiff,
                  handleRemoveDiff,
                )}
              </div>
              <textarea
                id="profile-template"
                value={template}
                onChange={(e) => {
                  const next = e.target.value
                  const selectionStart = e.target.selectionStart
                  setDiffRanges((prev) =>
                    prev.length > 0
                      ? adjustRangesForEdit(
                          prev,
                          template,
                          next,
                          selectionStart,
                        )
                      : prev,
                  )
                  setTemplate(next)
                }}
                onMouseMove={handleTemplateMouseMove}
                onMouseLeave={(e) => {
                  if (
                    !(
                      e.relatedTarget instanceof HTMLElement &&
                      e.relatedTarget.closest("button, [data-diff-actions]")
                    )
                  ) {
                    setHoveredPlaceholderIndex(null)
                    setHoveredDiffIndex(null)
                  }
                }}
                placeholder="Enter your profile template using {placeholder} for sensitive data..."
                spellCheck={false}
                className="col-start-1 row-start-1 h-full w-full resize-none overflow-hidden bg-transparent py-2 pr-5 pl-3 font-mono text-sm leading-relaxed whitespace-pre-wrap break-words text-transparent caret-foreground selection:bg-primary/25 selection:text-transparent placeholder:text-muted-foreground focus:outline-none"
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
