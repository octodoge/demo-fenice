/* AIGEN ADD START */

import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { Save } from "lucide-react"
import { Suspense, useMemo, useState } from "react"

import { type ProfileCreate, ProfileService } from "@/client"
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

function renderHighlightedTemplate(template: string) {
  return template.split(PLACEHOLDER_TOKEN_REGEX).map((part, index) => {
    if (
      part.startsWith("{") &&
      part.endsWith("}") &&
      part !== "{{" &&
      part !== "}}"
    ) {
      return (
        <span key={index} className="rounded-xs bg-primary/15 text-primary">
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
        <LoadingButton className="my-4" disabled>
          <Save className="mr-2" />
          Save
        </LoadingButton>
      </div>
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
        <LoadingButton
          className="my-4"
          loading={mutation.isPending}
          disabled={!isDirty}
          onClick={handleSave}
        >
          <Save className="mr-2" />
          Save
        </LoadingButton>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="profile-template">Profile Template</Label>
        <div className="grid min-h-48 w-full rounded-md border border-input bg-transparent shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 dark:bg-input/30">
          <div
            aria-hidden="true"
            className="pointer-events-none col-start-1 row-start-1 w-full px-3 py-2 font-mono text-sm leading-relaxed whitespace-pre-wrap break-words"
          >
            {renderHighlightedTemplate(template)}
            {template.endsWith("\n") ? "\n " : null}
          </div>
          <textarea
            id="profile-template"
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
            placeholder="Enter your profile template using {placeholder} for sensitive data..."
            spellCheck={false}
            className="col-start-1 row-start-1 h-full w-full resize-none overflow-hidden bg-transparent px-3 py-2 font-mono text-sm leading-relaxed whitespace-pre-wrap break-words text-transparent caret-foreground selection:bg-primary/25 selection:text-transparent placeholder:text-muted-foreground focus:outline-none"
          />
        </div>
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
            {placeholders.length > 0 ? (
              placeholders.map((key) => (
                <TableRow key={key}>
                  <TableCell className="font-mono text-sm font-medium text-primary">
                    {key}
                  </TableCell>
                  <TableCell>
                    <Input
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
                  No placeholders in template. Add {"{placeholder}"} tags above
                  to define sensitive data.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
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
