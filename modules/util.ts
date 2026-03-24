/**
 * Converts HSL color values to Hex color values
 */
function convertHSLToHex(hue: number, saturation: number, lightness: number): string {
    lightness /= 100;

    const chroma = (saturation * Math.min(lightness, 1 - lightness)) / 100;

    function getColorComponent(colorIndex: number): string {
        const colorPosition = (colorIndex + hue / 30) % 12;
        const colorValue = lightness - chroma * Math.max(Math.min(colorPosition - 3, 9 - colorPosition, 1), -1);

        return Math.round(255 * colorValue)
            .toString(16)
            .padStart(2, "0");
    }

    const red = getColorComponent(0);
    const green = getColorComponent(8);
    const blue = getColorComponent(4);

    return `#${red}${green}${blue}`;
}

/**
 * Generates random colors
 */
function generateColors(amount: number): string[] {
    const colors: string[] = [];
    let hue = 0;

    for (let i = 0; i < amount; i++) {
        const color = convertHSLToHex(hue, 100, 50);
        colors.push(color);
        hue += 360 / amount;
    }

    return colors;
}

function generateKey(size: number): string {
    let key = "";
    for (let i = 0; i < size; i++) {
        const keygen = "abcdefghijklmnopqrstuvwxyz123456789";
        const letter = keygen[Math.floor(Math.random() * keygen.length)];
        key += letter;
    }

    return key;
}

function camelCaseToNormal(str: string): string {
    let result = str.replace(/([A-Z])/g, " $1");
    result = result.charAt(0).toUpperCase() + result.slice(1);
    return result;
}

module.exports = {
    convertHSLToHex,
    generateColors,
    generateKey,
    camelCaseToNormal,
};
