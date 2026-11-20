import { useId, useRef, useState, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@vibe/ui/components/Button';
import { Input } from '@vibe/ui/components/Input';
import { Label } from '@vibe/ui/components/Label';
import { Textarea } from '@vibe/ui/components/Textarea';
import { writeClipboardText } from '@/shared/lib/clipboard';

interface CopyableFieldProps {
  label: string;
  value: string;
  copyLabel: string;
  multiline?: boolean;
}

export function CopyableField({
  label,
  value,
  copyLabel,
  multiline = false,
}: CopyableFieldProps) {
  const { t } = useTranslation('common');
  const id = useId();
  const fieldRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const [feedback, setFeedback] = useState<'copied' | 'selected' | null>(null);

  async function copy(event: MouseEvent<HTMLButtonElement>) {
    const button = event.currentTarget;
    const field = fieldRef.current;
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

  const fieldProps = {
    ref: (element: HTMLInputElement | HTMLTextAreaElement | null) => {
      fieldRef.current = element;
    },
    id,
    value,
    readOnly: true,
    autoComplete: 'off',
    spellCheck: false,
    className: 'min-w-0 font-mono',
  };

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div
        className={
          multiline ? 'flex items-start gap-2' : 'flex items-center gap-2'
        }
      >
        {multiline ? (
          <Textarea {...fieldProps} rows={3} wrap="off" />
        ) : (
          <Input {...fieldProps} />
        )}
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
