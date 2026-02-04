export const resolvers = [];

export default function handler() {
  return new Promise((resolve) => {
    resolvers.push(resolve);
  });
}

