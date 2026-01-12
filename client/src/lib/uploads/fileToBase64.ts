export async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Unexpected FileReader result"));
        return;
      }

      // result is a data URL: data:<mime>;base64,<payload>
      const commaIndex = result.indexOf(",");
      if (commaIndex === -1) {
        reject(new Error("Invalid data URL"));
        return;
      }

      resolve(result.slice(commaIndex + 1));
    };

    reader.readAsDataURL(file);
  });
}
