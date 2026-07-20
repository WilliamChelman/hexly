import { inputNumber, inputValue } from './input-value';

/** The `change` event a real input with `value` in it would raise. */
function changeEvent(value: string): Event {
  const input = document.createElement('input');
  input.value = value;
  let captured: Event | undefined;
  input.addEventListener('change', (event) => (captured = event));
  input.dispatchEvent(new Event('change'));
  return captured as Event;
}

describe('inputValue', () => {
  it("reads the raising input's current value", () => {
    expect(inputValue(changeEvent('hello'))).toBe('hello');
  });
});

describe('inputNumber', () => {
  it('parses a numeric entry at full precision', () => {
    expect(inputNumber(changeEvent('10.123456'))).toBe(10.123456);
    expect(inputNumber(changeEvent('-50'))).toBe(-50);
  });

  it('yields null for an empty field — Number("") === 0 would silently commit zero', () => {
    expect(inputNumber(changeEvent(''))).toBeNull();
    expect(inputNumber(changeEvent('   '))).toBeNull();
  });

  it('yields null for a non-finite or non-numeric entry', () => {
    expect(inputNumber(changeEvent('1e400'))).toBeNull(); // Number('1e400') === Infinity
    expect(inputNumber(changeEvent('abc'))).toBeNull();
  });
});
