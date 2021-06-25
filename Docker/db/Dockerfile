# Derived from official mysql image (our base image)
FROM mysql:5.7.25
# Add a database
ENV MYSQL_DATABASE trinity
ENV MYSQL_ROOT_PASSWORD: root
ENV MYSQL_USER: root
ENV MYSQL_PASSWORD: root

# Add the content of the sql-scripts/ directory to your image
# All scripts in docker-entrypoint-initdb.d/ are automatically
# executed during container startup

COPY ./scripts/ /docker-entrypoint-initdb.d/

#PORT
EXPOSE 3306