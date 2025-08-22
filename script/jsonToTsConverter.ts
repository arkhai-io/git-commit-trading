const fs = require('fs');
const path = require('path');

/**
 * Converts a JSON file to a TypeScript file.
 * @param {string} inputFilePath - The path to the JSON file.
 * @param {string} outputFilePath - The path to the output TypeScript file.
 */
function convertJsonToTs(inputFilePath: string, outputFilePath: string) {
    try {
        // Read the JSON file
        const jsonData = fs.readFileSync(inputFilePath, 'utf8');

        // Parse the JSON data to ensure it's valid
        const parsedData = JSON.parse(jsonData);

        // Generate TypeScript content in the desired format
        const tsContent = `export const abi = ${JSON.stringify(parsedData, null, 2)};`;

        // Write the TypeScript content to the output file
        fs.writeFileSync(outputFilePath, tsContent, 'utf8');

        console.log(`Successfully converted ${inputFilePath} to ${outputFilePath}`);
    } catch (error: unknown) {
        if (error instanceof Error) {
            console.error(`Error converting JSON to TS: ${error.message}`);
        } else {
            console.error('An unknown error occurred.');
        }
    }
}

// Example usage
const inputDir = path.resolve(__dirname, '../src/contracts');
const outputDir = path.resolve(__dirname, '../src/contracts');

fs.readdirSync(inputDir).forEach((file: string) => {
    if (file.endsWith('.json')) {
        const inputFilePath = path.join(inputDir, file);
        const outputFilePath = path.join(outputDir, file.replace('.json', '.ts'));
        convertJsonToTs(inputFilePath, outputFilePath);
    }
});
