import { useState, type ComponentProps } from "react"
import { EyeIcon, EyeOffIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

type SecretInputProps = Omit<ComponentProps<typeof Input>, "type">

/** Password-style field with a reveal toggle, for tokens and API keys. */
export function SecretInput({ className, ...props }: SecretInputProps) {
  const { t } = useTranslation()
  const [isVisible, setIsVisible] = useState(false)
  const label = t(isVisible ? "settings.hideValue" : "settings.showValue")

  return (
    <div className="relative">
      <Input
        {...props}
        type={isVisible ? "text" : "password"}
        autoComplete="off"
        spellCheck={false}
        className={cn("pr-9", className)}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={label}
        title={label}
        className="absolute top-1/2 right-1.5 -translate-y-1/2 text-muted-foreground"
        onClick={() => setIsVisible((visible) => !visible)}
      >
        {isVisible ? <EyeOffIcon /> : <EyeIcon />}
      </Button>
    </div>
  )
}
