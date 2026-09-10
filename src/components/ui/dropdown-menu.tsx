"use client"

import * as React from "react"
import { cn } from "cn"
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui"
import { ChevronRightIcon } from "lucide-react"

function DropdownMenu({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Root>) {
  return <DropdownMenuPrimitive.Root data-slot="dropdown-menu" {...props} />
}

function DropdownMenuTrigger({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Trigger>) {
  return <DropdownMenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />
}

function DropdownMenuPortal({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Portal>) {
  return <DropdownMenuPrimitive.Portal data-slot="dropdown-menu-portal" {...props} />
}

function DropdownMenuContent({
  className,
  sideOffset = 6,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPortal>
      <DropdownMenuPrimitive.Content
        data-slot="dropdown-menu-content"
        sideOffset={sideOffset}
        className={cn(
          "z-50 min-w-[12rem] overflow-hidden rounded-md border bg-popover p-1 text-sm text-popover-foreground shadow-md duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          className
        )}
        {...props}
      />
    </DropdownMenuPortal>
  )
}

function DropdownMenuItem({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Item> & {
  variant?: "default" | "destructive"
}) {
  return (
    <DropdownMenuPrimitive.Item
      data-slot="dropdown-menu-item"
      data-variant={variant}
      className={cn(
        "relative flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50 data-[variant=destructive]:text-destructive data-[variant=destructive]:data-[highlighted]:bg-destructive/10 [&_svg]:pointer-events-none [&_svg]:shrink-0",
        className
      )}
      {...props}
    />
  )
}

function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn("-mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  )
}

function DropdownMenuLabel({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Label>) {
  return (
    <DropdownMenuPrimitive.Label
      data-slot="dropdown-menu-label"
      className={cn("px-2 py-1.5 text-xs font-semibold text-muted-foreground", className)}
      {...props}
    />
  )
}

function DropdownMenuSub({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Sub>) {
  return <DropdownMenuPrimitive.Sub data-slot="dropdown-menu-sub" {...props} />
}

function DropdownMenuSubTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubTrigger>) {
  return (
    <DropdownMenuPrimitive.SubTrigger
      data-slot="dropdown-menu-sub-trigger"
      className={cn(
        "flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-open:bg-accent data-open:text-accent-foreground",
        className
      )}
      {...props}
    >
      {children}
      <ChevronRightIcon className="ml-auto size-4" />
    </DropdownMenuPrimitive.SubTrigger>
  )
}

function DropdownMenuSubContent({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubContent>) {
  return (
    <DropdownMenuPortal>
      <DropdownMenuPrimitive.SubContent
        data-slot="dropdown-menu-content"
        className={cn(
          "z-50 min-w-[10rem] overflow-hidden rounded-md border bg-popover p-1 text-sm text-popover-foreground shadow-lg data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          className
        )}
        {...props}
      />
    </DropdownMenuPortal>
  )
}

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuPortal,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
}
