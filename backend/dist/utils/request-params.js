export const getSingleParam = (value) => {
    if (Array.isArray(value)) {
        const first = value[0];
        return typeof first === 'string' ? first : undefined;
    }
    return typeof value === 'string' ? value : undefined;
};
