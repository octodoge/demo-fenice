/* AIGEN DEL START */
// import { FaGithub, FaLinkedinIn } from "react-icons/fa"
// import { FaXTwitter } from "react-icons/fa6"
//
// const socialLinks = [
//   {
//     icon: FaGithub,
//     href: "https://github.com/fastapi/fastapi",
//     label: "GitHub",
//   },
//   { icon: FaXTwitter, href: "https://x.com/fastapi", label: "X" },
//   {
//     icon: FaLinkedinIn,
//     href: "https://linkedin.com/company/fastapi",
//     label: "LinkedIn",
//   },
// ]
/* AIGEN DEL END */

export function Footer() {
  const currentYear = new Date().getFullYear()

  return (
    <footer className="border-t py-4 px-6">
      {/* AIGEN MOD START */}
      {/* <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
        <p className="text-muted-foreground text-sm">
          Full Stack FastAPI Template - {currentYear}
        </p>
        <div className="flex items-center gap-4">
          {socialLinks.map(({ icon: Icon, href, label }) => (
            <a
              key={label}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={label}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <Icon className="h-5 w-5" />
            </a>
          ))}
        </div>
      </div> */}
      {/* AIGEN MOD CONT */}
      <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
        <p className="text-muted-foreground text-sm">
          SnapFill © {currentYear} Fenice Distribuzione s.r.l. - All rights
          reserved
        </p>
      </div>
      {/* AIGEN MOD END */}
    </footer>
  )
}
