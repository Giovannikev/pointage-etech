import { CheckInWidget } from "@/components/leaves/CheckInWidget"
import { ThemeToggle } from "@/components/ThemeToggle"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"

export function SiteHeader({ title }: { title: string }) {
  return (
    <header className="sticky top-0 z-40 flex h-(--header-height) shrink-0 items-center gap-2 border-b bg-background/85 backdrop-blur-md transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height) md:rounded-t-xl">
      <div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
        <SidebarTrigger className="-ml-1" />
        <Separator
          orientation="vertical"
          className="mx-2 data-[orientation=vertical]:h-4"
        />
        <h1 className="min-w-0 truncate text-base font-medium">{title}</h1>
        <div className="ml-auto flex items-center gap-1">
          <CheckInWidget />
          <ThemeToggle />
        </div>
      </div>
    </header>
  )
}
