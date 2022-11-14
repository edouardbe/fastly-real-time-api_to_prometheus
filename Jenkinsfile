pipeline {
  agent any
  
  environment {
    GIT_SHORT_HASH = GIT_COMMIT.take(7)
    PKG_REVISION = "$GIT_SHORT_HASH-$BUILD_NUMBER"
    DOCKER_REPO = 'mubi/fastly-metrics-scraper'
    DOCKER_BUILDKIT = 1
    DOCKER_LOCAL_TAG = "$PKG_REVISION"
  }

  stages {
    stage('Build Image') {
      steps {
        sh 'docker build --progress=plain -t "$DOCKER_REPO:$DOCKER_LOCAL_TAG" .'
      }
    }
    stage('Docker login') {
      environment {
        DOCKER_HUB = credentials('dockerhub-mubiadmin')
      }
      steps {
        sh 'echo "${DOCKER_HUB_PSW}" | docker login -u "${DOCKER_HUB_USR}" --password-stdin'
      }
    }
    stage('Push Docker image') {
      steps {
        sh 'docker push "$DOCKER_REPO:$DOCKER_LOCAL_TAG"'

        sh 'docker tag "$DOCKER_REPO:$DOCKER_LOCAL_TAG" "$DOCKER_REPO:$BRANCH_NAME"'
        sh 'docker push "$DOCKER_REPO:$BRANCH_NAME"'
      }
    }
    stage('Push Docker image "latest" tag') {
      when {
        branch 'master'
      }
      steps {
        sh 'docker tag "$DOCKER_REPO:$DOCKER_LOCAL_TAG" "$DOCKER_REPO:latest"'
        sh 'docker push "$DOCKER_REPO:latest"'
      }
    }
  }
  post {
    success {
      slackSend baseUrl: 'https://mubi.slack.com/services/hooks/jenkins-ci/',
        botUser: true,
        channel: '#infra-notifications',
        color: 'good',
        message: "Build '${env.JOB_NAME}' - '[${env.BUILD_NUMBER}]' Successful '${env.RUN_DISPLAY_URL}'",
        teamDomain: 'mubi',
        tokenCredentialId: 'jenkins-slack-token-real'
    }
    failure {
      slackSend baseUrl: 'https://mubi.slack.com/services/hooks/jenkins-ci/',
        botUser: true,
        channel: '#infra-notifications',
        color: 'danger',
        message: "Build '${env.JOB_NAME}' - '[${env.BUILD_NUMBER}]' Failed '${env.RUN_DISPLAY_URL}'",
        teamDomain: 'mubi',
        tokenCredentialId: 'jenkins-slack-token-real'
    }
    always {
      cleanWs()
    }
  }
}
