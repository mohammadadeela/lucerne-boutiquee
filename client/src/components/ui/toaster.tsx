import * as React from "react"
import { useToast } from "@/hooks/use-toast"
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from "@/components/ui/toast"
import { cn } from "@/lib/utils"

function SwipeableToast({ id, title, description, action, onDismiss, onClick, ...props }: any) {
  const touchStartY = React.useRef<number | null>(null)
  const [offsetY, setOffsetY] = React.useState(0)
  const [dismissing, setDismissing] = React.useState<"up" | "down" | null>(null)

  const THRESHOLD = 50

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY
  }

  const handleTouchMove = (e: React.TouchEvent) => {
    if (touchStartY.current === null) return
    const delta = e.touches[0].clientY - touchStartY.current
    setOffsetY(delta)
  }

  const handleTouchEnd = () => {
    if (Math.abs(offsetY) >= THRESHOLD) {
      const dir = offsetY < 0 ? "up" : "down"
      setDismissing(dir)
      setTimeout(() => onDismiss(id), 250)
    } else {
      setOffsetY(0)
    }
    touchStartY.current = null
  }

  const dismissStyle: React.CSSProperties = dismissing
    ? {
        transform: `translateY(${dismissing === "up" ? "-120%" : "120%"})`,
        opacity: 0,
        transition: "transform 250ms ease, opacity 250ms ease",
        pointerEvents: "none",
      }
    : offsetY !== 0
    ? {
        transform: `translateY(${offsetY}px)`,
        opacity: Math.max(0, 1 - Math.abs(offsetY) / 150),
        transition: "none",
      }
    : {}

  const handleBodyClick = onClick
    ? () => {
        onClick()
        onDismiss(id)
      }
    : undefined

  return (
    <div
      style={dismissStyle}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <Toast {...props}>
        <div
          className={cn("grid gap-1 flex-1", onClick && "cursor-pointer")}
          onClick={handleBodyClick}
        >
          {title && <ToastTitle>{title}</ToastTitle>}
          {description && <ToastDescription>{description}</ToastDescription>}
        </div>
        {action}
        <ToastClose />
      </Toast>
    </div>
  )
}

export function Toaster() {
  const { toasts, dismiss } = useToast()

  return (
    <ToastProvider swipeDirection="up" swipeThreshold={50}>
      {toasts.map(({ id, title, description, action, onClick, ...props }: any) => (
        <SwipeableToast
          key={id}
          id={id}
          title={title}
          description={description}
          action={action}
          onClick={onClick}
          onDismiss={dismiss}
          {...props}
        />
      ))}
      <ToastViewport />
    </ToastProvider>
  )
}
