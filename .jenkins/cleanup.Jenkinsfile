@Library('jenkins-shared-library') _

pipeline {
  agent {
    kubernetes {
      defaultContainer 'infra-cli'
      yamlFile '.jenkins/infra-cli-pod.yaml'
    }
  }

  environment {
    SLACK_CHANNEL = '#infra-builds'
  }
  
  stages {
    stage('Clean up') {
      steps {
        script {
          cleanUp('image')
        }
      }
    }
  }

  post {
    always {
      mubiSlackSend(env.SLACK_CHANNEL)
      cleanWs()
    }
  }
}
