import { useId, useRef, useState, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@vibe/ui/components/Button';
import { Input } from '@vibe/ui/components/Input';
import { Label } from '@vibe/ui/components/Label';
import { writeClipboardText } from '@/shared/lib/clipboard';

interface CopyableFieldProps {
  label: string;
  value: string;
  copyLabel: string;
}

export function CopyableField({ label, value, copyLabel }: CopyableFieldProps) {
  const { t } = useTranslation('common');
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [feedback, setFeedback] = useState<'copied' | 'selected' | null>(null);

  async function copy(event: MouseEvent<HTMLButtonElement>) {
    const button = event.currentTarget;
    const field = input.current;
    if (!field) return;

    const copied = await writeClipboardText(value, () => {
      field.focus();
      field.select();
    });
    if (copied && document.activeElement === field) {
      button.focus();
    }
    setFeedback(copied ? 'copied' : 'selected');
  }

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <Input
          ref={input}
          id={id}
          value={value}
          readOnly
          autoComplete="off"
          spellCheck={false}
          className="min-w-0 font-mono"
        />
        <Button
          type="button"
          variant="outline"
          className="shrink-0"
          onClick={(event) => void copy(event)}
        >
          {copyLabel}
        </Button>
      </div>
      {feedback && (
        <p role="status" className="text-xs text-low">
          {feedback === 'copied'
            ? t('clipboard.copied')
            : t('clipboard.selected')}
        </p>
      )}
    </div>
  );
}
