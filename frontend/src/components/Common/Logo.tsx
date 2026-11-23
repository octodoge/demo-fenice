/* AIGEN MOD START */
// import { Link } from "@tanstack/react-router"
//
// import { useTheme } from "@/components/theme-provider"
// import { cn } from "@/lib/utils"
// import icon from "/assets/images/fastapi-icon.svg"
// import iconLight from "/assets/images/fastapi-icon-light.svg"
// import logo from "/assets/images/fastapi-logo.svg"
// import logoLight from "/assets/images/fastapi-logo-light.svg"
/* AIGEN MOD CONT */
import { Link } from "@tanstack/react-router"
import { PencilSparkles } from "lucide-react"

import { cn } from "@/lib/utils"

/* AIGEN MOD END */

interface LogoProps {
  variant?: "full" | "icon" | "responsive"
  className?: string
  asLink?: boolean
}

export function Logo({
  variant = "full",
  className,
  asLink = true,
}: LogoProps) {
  /* AIGEN MOD START */
  // const { resolvedTheme } = useTheme()
  // const isDark = resolvedTheme === "dark"
  //
  // const fullLogo = isDark ? logoLight : logo
  // const iconLogo = isDark ? iconLight : icon
  //
  // const content =
  //   variant === "responsive" ? (
  //     <>
  //       <img
  //         src={fullLogo}
  //         alt="FastAPI"
  //         className={cn(
  //           "h-6 w-auto group-data-[collapsible=icon]:hidden",
  //           className,
  //         )}
  //       />
  //       <img
  //         src={iconLogo}
  //         alt="FastAPI"
  //         className={cn(
  //           "size-5 hidden group-data-[collapsible=icon]:block",
  //           className,
  //         )}
  //       />
  //     </>
  //   ) : (
  //     <img
  //       src={variant === "full" ? fullLogo : iconLogo}
  //       alt="FastAPI"
  //       className={cn(variant === "full" ? "h-6 w-auto" : "size-5", className)}
  //     />
  //   )
  /* AIGEN MOD CONT */
  const content =
    variant === "icon" ? (
      <PencilSparkles
        aria-label="SnapFill"
        className={cn("size-5 shrink-0 text-primary", className)}
      />
    ) : (
      <span
        className={cn(
          "inline-flex items-center gap-2 text-xl font-bold tracking-tight text-primary",
          className,
        )}
      >
        <PencilSparkles className="size-[1.2em] shrink-0" />
        <span
          className={cn(
            variant === "responsive" && "group-data-[collapsible=icon]:hidden",
          )}
        >
          SnapFill
        </span>
      </span>
    )
  /* AIGEN MOD END */

  if (!asLink) {
    return content
  }

  return <Link to="/">{content}</Link>
}
