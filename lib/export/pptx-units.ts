export const PX_PER_INCH = 75;
/** 逻辑画布单位先按 75 unit/in 映射，再按 72 pt/in 换算，保证文字与几何的相对比例一致。 */
export const PT_PER_PX = 72 / PX_PER_INCH;

export const inches = (px: number) => px / PX_PER_INCH;
export const hex = (color: string) => color.replace(/^#/, "").toUpperCase();
