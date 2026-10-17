import { Icon } from "../_components/Icon";
import styles from "./auth.module.css";

/** Radio group of member colors, shown as swatches with a check on the chosen one. */
export function ColorPicker({
  colors,
  value,
  onChange,
}: {
  colors: readonly string[];
  value: string;
  onChange: (color: string) => void;
}) {
  return (
    <fieldset className={styles.colors}>
      <legend>Sua cor</legend>
      <div className={styles.swatches}>
        {colors.map((c) => (
          <label key={c} className={styles.swatchLabel}>
            <input type="radio" name="color" value={c} checked={value === c} onChange={() => onChange(c)} />
            <span aria-label={c} className={styles.swatch} style={{ background: c }}>
              <Icon name="check" size={18} className={styles.swatchCheck} />
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
