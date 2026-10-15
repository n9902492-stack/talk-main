import { useEffect, useRef, type KeyboardEvent } from 'react';

type OtpCodeInputProps = {
  digits: string[];
  onChange: (digits: string[]) => void;
  disabled: boolean;
  invalid?: boolean;
};

export default function OtpCodeInput({ digits, onChange, disabled, invalid }: OtpCodeInputProps) {
  const inputs = useRef<Array<HTMLInputElement | null>>([]);
  const focus = (index: number) => {
    const input = inputs.current[Math.max(0, Math.min(5, index))];
    input?.focus(); input?.select();
  };
  useEffect(() => { if (!disabled) focus(0); }, [disabled]);

  const enter = (index: number, raw: string) => {
    const value = raw.replace(/\D/g, '').slice(0, 6);
    const next = [...digits];
    if (value.length === 6) {
      onChange(value.split('')); focus(5); return;
    }
    if (!value) { next[index] = ''; onChange(next); return; }
    for (let offset = 0; offset < value.length && index + offset < 6; offset++) next[index + offset] = value[offset];
    onChange(next); focus(Math.min(5, index + value.length));
  };
  const keyDown = (index: number, event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Backspace' && !digits[index] && index > 0) {
      event.preventDefault();
      const next = [...digits]; next[index - 1] = ''; onChange(next); focus(index - 1);
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault(); focus(index + (event.key === 'ArrowLeft' ? -1 : 1));
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault(); focus(event.key === 'Home' ? 0 : 5);
    }
  };

  return <fieldset className="auth-otp-fieldset" disabled={disabled} aria-describedby="verification-expiry">
    <legend className="field-label">Verification code</legend>
    <div className="auth-otp-inputs">
      {Array.from({ length: 6 }, (_, index) => <input
        key={index} ref={input => { inputs.current[index] = input; }}
        id={`verification-digit-${index + 1}`} name={`code-${index + 1}`}
        className="form-input auth-otp-digit" aria-label={`Verification digit ${index + 1}`}
        type="text" inputMode="numeric" autoComplete={index === 0 ? 'one-time-code' : 'off'}
        pattern="[0-9]" maxLength={index === 0 ? 6 : 1} required placeholder="–"
        disabled={disabled} aria-invalid={invalid || undefined} aria-describedby="verification-expiry"
        value={digits[index] || ''} onFocus={event => event.currentTarget.select()}
        onChange={event => enter(index, event.target.value)} onKeyDown={event => keyDown(index, event)}
        onPaste={event => { event.preventDefault(); enter(index, event.clipboardData.getData('text')); }}
      />)}
    </div>
  </fieldset>;
}
