# Build stage
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Build Create React App (outputs to /app/build)
RUN npm run build

# Production stage (serve static build with nginx)
FROM nginx:1.25-alpine

# Needed because docker-compose healthcheck uses wget
RUN apk add --no-cache wget

# Replace default site config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy built files from builder stage
COPY --from=builder /app/build /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]