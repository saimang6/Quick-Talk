# Use an official Python runtime as a parent image
FROM python:3.11-slim

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE 1
ENV PYTHONUNBUFFERED 1

# Set work directory
WORKDIR /usr/src/app

# 3. Copy requirements.txt
COPY requirements.txt .

# 4. Install system dependencies for mysqlclient (updated from previous steps)
RUN apt update && \
    apt install -y default-libmysqlclient-dev pkg-config build-essential && \
    rm -rf /var/lib/apt/lists/*

# 5. Install Python dependencies (including mysqlclient)
RUN pip install --no-cache-dir -r requirements.txt

# 6. Copy project files
COPY . .