/** @type {import('tailwindcss').Config} */
export default {
    content: ["./src/**/*.{js,jsx,ts,tsx}"],
    theme: {
        extend: {},
        fontFamily: {
            sans: ["'IBM Plex Mono'","serif"],
            serif: ["'IBM Plex Mono'","serif"],
        },
    },
    plugins: [
        require("@tailwindcss/typography"),
        // ...
    ],
};
